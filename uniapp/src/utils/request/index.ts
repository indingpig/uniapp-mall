import { createRequest } from './createRequest';
import { defaultInterceptor } from './interceptor';

const http = createRequest({
  interceptors: defaultInterceptor,
});

export default http;
export * from './createRequest';
