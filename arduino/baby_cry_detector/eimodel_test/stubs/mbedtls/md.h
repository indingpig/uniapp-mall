#pragma once
#include <stdint.h>
#include <stddef.h>
#define MBEDTLS_MD_SHA1 2
typedef struct mbedtls_md_info_t mbedtls_md_info_t;
const mbedtls_md_info_t* mbedtls_md_info_from_type(int md_type);
int mbedtls_md(const mbedtls_md_info_t* md, const unsigned char* input, size_t ilen, unsigned char* output);
