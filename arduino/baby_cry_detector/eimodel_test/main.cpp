/*
 * Host-side test harness for the Edge Impulse "babyCry" model.
 *
 * Goal: determine whether "everything classifies as speach (99.6%)" is caused by
 *   (a) a degenerate/badly trained model, or
 *   (b) the device input chain (x8 int16 gain with wraparound clipping) distorting
 *       the audio before it reaches the model.
 *
 * We feed the model the EXACT pipeline the firmware uses:
 *   int16 sample -> (int16_t)(sample * 8)   [firmware gain, int16 wraparound]
 *   -> int16_to_float -> MFE -> NN
 *
 * Usage: ei_test [wav files...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <vector>
#include <string>

#include "edge-impulse-sdk/classifier/ei_run_classifier.h"
#include "model-parameters/model_variables.h"

/* ------------------------------------------------------------------ */
/*  Audio generators (values are in int16 scale, i.e. +/-32768)         */
/* ------------------------------------------------------------------ */

static std::vector<float> gen_sine(double freq, double amp, size_t n, uint32_t sr) {
    std::vector<float> v(n);
    for (size_t i = 0; i < n; i++) {
        v[i] = (float)(amp * sin(2.0 * M_PI * freq * (double)i / (double)sr));
    }
    return v;
}

/* Baby-cry-like: FM sweep of fundamental 350->600 Hz with harmonics and AM */
static std::vector<float> gen_cry_like(size_t n, uint32_t sr) {
    std::vector<float> v(n);
    for (size_t i = 0; i < n; i++) {
        double t = (double)i / (double)sr;
        double f0 = 350.0 + 250.0 * sin(2.0 * M_PI * 0.7 * t); // fundamental wobble
        double phase = 2.0 * M_PI * (f0 * t + 40.0 * sin(2.0 * M_PI * 0.5 * t));
        double am = 0.5 + 0.5 * sin(2.0 * M_PI * 2.3 * t);     // rhythmic bursts
        double s = am * (sin(phase) + 0.5 * sin(2.0 * phase) + 0.25 * sin(3.0 * phase));
        v[i] = (float)(s * 9000.0);
    }
    return v;
}

static std::vector<float> gen_noise(double amp, size_t n, uint32_t seed) {
    std::vector<float> v(n);
    srand(seed);
    for (size_t i = 0; i < n; i++) {
        v[i] = (float)(((double)rand() / RAND_MAX * 2.0 - 1.0) * amp);
    }
    return v;
}

static std::vector<float> gen_silence(size_t n) {
    return std::vector<float>(n, 0.0f);
}

/* ------------------------------------------------------------------ */
/*  WAV loader (16-bit PCM)                                             */
/* ------------------------------------------------------------------ */

static bool load_wav16(const char *path, std::vector<float> &out, uint32_t &sr) {
    FILE *f = fopen(path, "rb");
    if (!f) return false;
    char hdr[44];
    if (fread(hdr, 1, 44, f) != 44 || memcmp(hdr, "RIFF", 4) || memcmp(hdr + 8, "WAVE", 4)) {
        fclose(f);
        return false;
    }
    uint16_t channels = hdr[22] | (hdr[23] << 8);
    sr = hdr[24] | (hdr[25] << 8) | (hdr[26] << 16) | (hdr[27] << 24);
    uint16_t bits = hdr[34] | (hdr[35] << 8);
    if (bits != 16) { fclose(f); return false; }

    // scan chunks
    out.clear();
    size_t pos = 12;
    while (pos + 8 <= 44) {
        char id[4];
        uint32_t sz;
        // re-read from chunk listing (hdr already has 12 bytes consumed)
        break;
    }
    // simpler: assume PCM data right after 44-byte header (true for these files)
    uint32_t data_size = hdr[40] | (hdr[41] << 8) | (hdr[42] << 16) | (hdr[43] << 24);
    size_t n_samples = data_size / 2 / channels;
    out.resize(n_samples);
    for (size_t i = 0; i < n_samples; i++) {
        uint8_t b[2];
        if (fread(b, 1, 2, f) != 2) { out.resize(i); break; }
        int16_t s = (int16_t)(b[0] | (b[1] << 8));
        out[i] = (float)s;
        if (channels == 2) { fread(b, 1, 2, f); } // skip right channel
    }
    fclose(f);
    return true;
}

/* ------------------------------------------------------------------ */
/*  Device chain emulation                                              */
/* ------------------------------------------------------------------ */

/* Exactly what esp32_microphone.ino does: int16 * 8 with int16 wraparound */
static std::vector<float> device_gain_x8_wrap(const std::vector<float> &in) {
    std::vector<float> out(in.size());
    for (size_t i = 0; i < in.size(); i++) {
        int16_t s = (int16_t)((int16_t)((int16_t)in[i]) * 8);
        out[i] = (float)s;
    }
    return out;
}

/* Arbitrary gain with int16 wraparound, for level-sweep tests */
static std::vector<float> gain_wrap(const std::vector<float> &in, double g) {
    std::vector<float> out(in.size());
    for (size_t i = 0; i < in.size(); i++) {
        int16_t s = (int16_t)((int16_t)in[i] * g);
        out[i] = (float)s;
    }
    return out;
}

static std::vector<float> device_gain_x8_clamp(const std::vector<float> &in) {
    std::vector<float> out(in.size());
    for (size_t i = 0; i < in.size(); i++) {
        double s = (double)in[i] * 8.0;
        if (s > 32767.0) s = 32767.0;
        if (s < -32768.0) s = -32768.0;
        out[i] = (float)s;
    }
    return out;
}

/* Per-window AGC: scale so window RMS hits target, gain clamped, then clamp int16.
 * This is the proposed firmware fix replacing the fixed x8 wraparound gain. */
static std::vector<float> agc_normalize(const std::vector<float> &in, double target_rms) {
    double sumSq = 0;
    for (size_t i = 0; i < in.size(); i++) sumSq += (double)in[i] * in[i];
    double rms = sqrt(sumSq / (double)in.size());
    double g = (rms > 1.0) ? target_rms / rms : 64.0;
    if (g < 0.25) g = 0.25;
    if (g > 64.0) g = 64.0;
    std::vector<float> out(in.size());
    for (size_t i = 0; i < in.size(); i++) {
        double v = (double)in[i] * g;
        if (v > 32767.0) v = 32767.0;
        if (v < -32768.0) v = -32768.0;
        out[i] = (float)v;
    }
    return out;
}

static void audio_stats(const std::vector<float> &a, const char *tag) {
    double sum = 0, sumSq = 0;
    size_t clip = 0;
    double peak = 0;
    for (size_t i = 0; i < a.size(); i++) {
        sum += a[i];
        sumSq += (double)a[i] * a[i];
        double av = fabs(a[i]);
        if (av > peak) peak = av;
        if (av > 32760.0) clip++;
    }
    size_t n = a.size();
    double rms = sqrt(sumSq / n);
    printf("    [%s] n=%zu RMS=%.0f peak=%.0f clip@32760=%zu (%.2f%%)\n",
           tag, n, rms, peak, clip, 100.0 * clip / n);
}

/* ------------------------------------------------------------------ */
/*  Inference runner                                                    */
/* ------------------------------------------------------------------ */

static std::vector<float> g_audio;

static int raw_audio_get_data(size_t offset, size_t length, float *out_ptr) {
    if (offset + length > g_audio.size()) return -1;
    memcpy(out_ptr, &g_audio[offset], length * sizeof(float));
    return 0;
}

static void run_one(const char *name, const std::vector<float> &audio, bool print_features) {
    g_audio = audio;

    audio_stats(audio, "input");

    signal_t signal;
    signal.total_length = EI_CLASSIFIER_RAW_SAMPLE_COUNT;
    signal.get_data = &raw_audio_get_data;

    ei_impulse_result_t result = { 0 };
    uint64_t t0 = ei_read_timer_ms();
    EI_IMPULSE_ERROR r = run_classifier(&ei_default_impulse, &signal, &result, print_features);
    uint64_t t1 = ei_read_timer_ms();

    if (r != EI_IMPULSE_OK) {
        printf("    ERROR: run_classifier returned %d\n", (int)r);
        return;
    }

    printf("    -> ");
    for (size_t ix = 0; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
        printf("%s:%.4f ", result.classification[ix].label, result.classification[ix].value);
    }
    printf("(dsp:%dms cls:%dms total:%llums)\n",
           result.timing.dsp, result.timing.classification, (unsigned long long)(t1 - t0));
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

int main(int argc, char **argv) {
    printf("=== babyCry model host test ===\n");
    printf("Model: %s, classes: %s/%s/%s, %d Hz, window %d samples, threshold %.2f\n\n",
           EI_CLASSIFIER_PROJECT_NAME,
           ei_classifier_inferencing_categories[0],
           ei_classifier_inferencing_categories[1],
           ei_classifier_inferencing_categories[2],
           EI_CLASSIFIER_FREQUENCY, EI_CLASSIFIER_RAW_SAMPLE_COUNT, EI_CLASSIFIER_THRESHOLD);

    const uint32_t SR = EI_CLASSIFIER_FREQUENCY;
    const size_t N = EI_CLASSIFIER_RAW_SAMPLE_COUNT;

    struct Case { std::string name; std::vector<float> audio; bool debug; };
    std::vector<Case> cases;

    // raw signals (pre-gain)
    cases.push_back({"silence (raw)", gen_silence(N), false});
    cases.push_back({"1kHz sine amp=1000 (raw)", gen_sine(1000, 1000, N, SR), false});

    /* === 安静房间误报排查: 麦克风噪声底经固件 AGC(目标2500) 后的分类 ===
     * 固件 apply_agc() 只看 RMS, 没有 VAD/静音门限:
     *   rms > 1.0 时 gain = 2500/rms (上限 64)
     * 所以安静时的噪声底会被放大到与哭声相同的 RMS 电平。
     * 用不同强度的噪声模拟"安静程度", 看模型判成什么。 */
    {
        const double floors[] = { 3.0, 8.0, 15.0, 30.0, 60.0 };
        for (size_t k = 0; k < sizeof(floors) / sizeof(floors[0]); k++) {
            char nm[96];
            std::vector<float> nf = gen_noise(floors[k], N, (uint32_t)(100 + k));
            snprintf(nm, sizeof(nm), "quiet noisefloor RMS=%.0f (raw)", floors[k]);
            cases.push_back({nm, nf, false});
            snprintf(nm, sizeof(nm), "quiet noisefloor RMS=%.0f -> AGC2500", floors[k]);
            cases.push_back({nm, agc_normalize(nf, 2500.0), false});
        }
        // 极低电平: 固件在 rms<=1.0 时直接给最大增益 64
        std::vector<float> tiny = gen_noise(0.5, N, 999);
        cases.push_back({"quiet noisefloor RMS=0.5 -> AGC (gain=64)", agc_normalize(tiny, 2500.0), false});
    }
    cases.push_back({"1kHz sine amp=8000 (raw)", gen_sine(1000, 8000, N, SR), false});
    cases.push_back({"3kHz sine amp=8000 (raw)", gen_sine(3000, 8000, N, SR), false});
    cases.push_back({"cry-like amp~9000 (raw)", gen_cry_like(N, SR), false});
    cases.push_back({"white noise amp=8000 (raw)", gen_noise(8000, N, 42), false});
    cases.push_back({"white noise amp=2000 (raw)", gen_noise(2000, N, 43), false});

    // device chain: x8 with wraparound (what actually reaches the model)
    cases.push_back({"silence x8-wrap", device_gain_x8_wrap(gen_silence(N)), false});
    cases.push_back({"1kHz a=1000 x8-wrap", device_gain_x8_wrap(gen_sine(1000, 1000, N, SR)), false});
    cases.push_back({"1kHz a=8000 x8-wrap", device_gain_x8_wrap(gen_sine(1000, 8000, N, SR)), false});
    cases.push_back({"3kHz a=8000 x8-wrap", device_gain_x8_wrap(gen_sine(3000, 8000, N, SR)), false});
    cases.push_back({"cry-like x8-wrap", device_gain_x8_wrap(gen_cry_like(N, SR)), false});
    cases.push_back({"noise a=8000 x8-wrap", device_gain_x8_wrap(gen_noise(8000, N, 42)), false});
    cases.push_back({"noise a=2000 x8-wrap", device_gain_x8_wrap(gen_noise(2000, N, 43)), false});

    // device chain with proper clamping (reference: what it SHOULD be)
    cases.push_back({"1kHz a=8000 x8-clamp", device_gain_x8_clamp(gen_sine(1000, 8000, N, SR)), false});
    cases.push_back({"cry-like x8-clamp", device_gain_x8_clamp(gen_cry_like(N, SR)), false});

    // WAV files recorded from the device (each: raw, x8-wrap, and level sweep)
    for (int i = 1; i < argc; i++) {
        std::vector<float> wav;
        uint32_t wsr = 0;
        if (!load_wav16(argv[i], wav, wsr)) {
            printf("Cannot load wav: %s\n", argv[i]);
            continue;
        }
        printf("\n-- WAV %s (header sr=%d Hz, %zu samples) --\n", argv[i], (int)wsr, wav.size());
        if (wav.size() < N) {
            printf("  WAV shorter than model window (%zu < %d), padding with silence\n", wav.size(), (int)N);
            wav.resize(N, 0.0f);
        }
        cases.push_back({"WAV raw (gain1)", wav, false});
        cases.push_back({"WAV x8-wrap (device chain)", device_gain_x8_wrap(wav), false});
        cases.push_back({"WAV x8-clamp", device_gain_x8_clamp(wav), false});
        // level sweep: what if the same sound is louder/quieter?
        double gains[] = { 0.5, 2.0, 4.0, 16.0, 32.0, 64.0 };
        for (double g : gains) {
            char nm[64];
            snprintf(nm, sizeof(nm), "WAV gain x%.1f (wrap)", g);
            cases.push_back({nm, gain_wrap(wav, g), false});
        }
        // AGC: fix the level no matter how loud/quiet the source is
        cases.push_back({"WAV AGC->4000 (raw)", agc_normalize(wav, 4000.0), false});
        cases.push_back({"WAV AGC->4000 (x8-wrap src)", agc_normalize(device_gain_x8_wrap(wav), 4000.0), false});
        // AGC robustness: simulate source at 5 different input levels, AGC to 4000
        double inlevels[] = { 0.05, 0.2, 0.5, 1.5, 4.0 };
        for (double lv : inlevels) {
            std::vector<float> scaled = gain_wrap(wav, lv);
            double rms_in = 0;
            for (size_t q = 0; q < scaled.size(); q++) rms_in += (double)scaled[q] * scaled[q];
            rms_in = sqrt(rms_in / scaled.size());
            char nm[96];
            snprintf(nm, sizeof(nm), "WAV AGC srcRMS~%.0f -> 4000", rms_in);
            cases.push_back({nm, agc_normalize(scaled, 4000.0), false});
        }
        // feature-dump mode for the first WAV: run with debug=true (prints features)
        if (i == 1) {
            char nm[64];
            snprintf(nm, sizeof(nm), "WAV x8-wrap [FEATURE DUMP]");
            cases.push_back({nm, device_gain_x8_wrap(wav), true});
        }
    }

    printf("=== Results ===\n");
    for (size_t i = 0; i < cases.size(); i++) {
        printf("[%02zu] %s\n", i, cases[i].name.c_str());
        run_one(cases[i].name.c_str(), cases[i].audio, cases[i].debug);
    }
    printf("\n=== Done ===\n");
    return 0;
}
