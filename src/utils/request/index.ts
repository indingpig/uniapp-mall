import type { RequestOptions } from './type';
import { requestConfig } from './config';

function request(options: RequestOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: requestConfig.baseURL + options.url,
      method: options.method || 'GET',
      header: options.headers || {},
      timeout: options.timeout || requestConfig.timeout,
      data: options.data || {},
      success: (res) => {
        resolve(res);
      },
      fail: (err) => {
        reject(err);
      },
      complete: () => {
        if (options.loading !== false) {
          uni.hideLoading();
        }
      },
    });
  });
}

export default request;
