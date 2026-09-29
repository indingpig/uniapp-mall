#pragma once
#include <stdint.h>
#include <stddef.h>
#include "freertos/FreeRTOS.h"
typedef enum { I2S_NUM_0 = 0, I2S_NUM_1 = 1 } i2s_port_t;
typedef enum { I2S_BITS_PER_SAMPLE_8BIT = 8, I2S_BITS_PER_SAMPLE_16BIT = 16, I2S_BITS_PER_SAMPLE_32BIT = 32 } i2s_bits_per_sample_t;
typedef enum { I2S_CHANNEL_FMT_RIGHT_LEFT = 0, I2S_CHANNEL_FMT_ALL_RIGHT, I2S_CHANNEL_FMT_ALL_LEFT, I2S_CHANNEL_FMT_ONLY_RIGHT, I2S_CHANNEL_FMT_ONLY_LEFT } i2s_channel_fmt_t;
typedef enum { I2S_COMM_FORMAT_STAND_I2S = 1, I2S_COMM_FORMAT_I2S = 1, I2S_COMM_FORMAT_STAND_MSB = 2, I2S_COMM_FORMAT_MSB = 2 } i2s_comm_format_t;
#define I2S_MODE_MASTER 1
#define I2S_MODE_SLAVE 2
#define I2S_MODE_TX 4
#define I2S_MODE_RX 8
typedef int i2s_mode_t;
typedef struct { int mode; int sample_rate; i2s_bits_per_sample_t bits_per_sample; i2s_channel_fmt_t channel_format; i2s_comm_format_t communication_format; int intr_alloc_flags; int dma_buf_count; int dma_buf_len; bool use_apll; bool tx_desc_auto_clear; int fixed_mclk; } i2s_config_t;
typedef struct { int bck_io_num; int ws_io_num; int data_out_num; int data_in_num; } i2s_pin_config_t;
#define I2S_PIN_NO_CHANGE (-1)
#define ESP_INTR_FLAG_LEVEL1 1
#define ESP_OK 0
typedef int esp_err_t;
#define ESP_INTR_FLAG_LEVEL1 1
int i2s_driver_install(i2s_port_t, const i2s_config_t*, int, void*);
int i2s_set_pin(i2s_port_t, const i2s_pin_config_t*);
int i2s_zero_dma_buffer(i2s_port_t);
int i2s_read(i2s_port_t, void*, size_t, size_t*, int);
int i2s_driver_uninstall(i2s_port_t);
