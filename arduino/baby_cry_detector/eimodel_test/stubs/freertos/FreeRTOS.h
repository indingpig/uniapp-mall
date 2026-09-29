#pragma once
#include <stdint.h>
#define pdMS_TO_TICKS(ms) ((uint32_t)(ms))
#define portMAX_DELAY ((uint32_t)0xFFFFFFFF)
#define pdPASS 1
typedef void* TaskHandle_t;
