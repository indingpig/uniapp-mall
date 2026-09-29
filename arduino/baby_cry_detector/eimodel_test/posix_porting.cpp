/*
 * Minimal POSIX porting layer for the Edge Impulse SDK (host-side test harness).
 * Implements the weak/required EI functions declared in ei_classifier_porting.h.
 * This replaces the Arduino porting so the model can run on a desktop.
 */
#include "edge-impulse-sdk/porting/ei_classifier_porting.h"

#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

EI_IMPULSE_ERROR ei_sleep(int32_t time_ms) {
    usleep((useconds_t)time_ms * 1000);
    return EI_IMPULSE_OK;
}

uint64_t ei_read_timer_ms() {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000 + (uint64_t)tv.tv_usec / 1000;
}

uint64_t ei_read_timer_us() {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000000 + (uint64_t)tv.tv_usec;
}

void ei_printf(const char *format, ...) {
    va_list args;
    va_start(args, format);
    vprintf(format, args);
    va_end(args);
}

void ei_printf_float(float f) {
    printf("%.6f", f);
}

void ei_serial_set_baudrate(int baudrate) { (void)baudrate; }

void ei_putchar(char c) { putchar(c); }

char ei_getchar() { return (char)getchar(); }

void *ei_malloc(size_t size) { return malloc(size); }

void *ei_calloc(size_t nitems, size_t size) { return calloc(nitems, size); }

void ei_free(void *ptr) { free(ptr); }

extern "C" void DebugLog(const char *s) {
    fprintf(stderr, "%s", s);
}

EI_IMPULSE_ERROR ei_run_impulse_check_canceled() {
    return EI_IMPULSE_OK;
}
