#pragma once
#include "FreeRTOS.h"
#define xTaskCreate(fn, name, stack, arg, prio, handle) (0)
#define xTaskCreatePinnedToCore(fn, name, stack, arg, prio, handle, core) (0)
#define vTaskDelay(ticks)
#define vTaskDelete(handle)
