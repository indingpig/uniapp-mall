# Build the host-side EI model test harness
SDK   := /mnt/d/ArduinoProject/libraries/babyCry_inferencing/src
TF    := $(SDK)/edge-impulse-sdk/tensorflow
SRCS  := main.cpp posix_porting.cpp \
         $(SDK)/tflite-model/tflite_learn_1061363_3_compiled.cpp \
         $(SDK)/edge-impulse-sdk/dsp/kissfft/kiss_fft.cpp \
         $(SDK)/edge-impulse-sdk/dsp/kissfft/kiss_fftr.cpp \
         $(SDK)/edge-impulse-sdk/dsp/memory.cpp \
         $(wildcard $(TF)/lite/core/api/*.cpp) \
         $(wildcard $(TF)/lite/kernels/*.cpp) \
         $(wildcard $(TF)/lite/kernels/internal/*.cpp) \
         $(wildcard $(TF)/lite/kernels/custom/*.cpp) \
         $(wildcard $(TF)/lite/micro/*.cpp) \
         $(wildcard $(TF)/lite/micro/kernels/*.cpp) \
         $(wildcard $(TF)/lite/micro/memory_planner/*.cpp)
CXX   := g++
CXXFLAGS := -std=c++17 -O2 -w -I$(SDK) -DEI_PORTING_POSIX=1 -DEI_CLASSIFIER_ALLOCATION_STATIC

ei_test: $(SRCS)
	$(CXX) $(CXXFLAGS) -o $@ $(SRCS) -lm

clean:
	rm -f ei_test

.PHONY: clean
