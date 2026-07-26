import uniHelper from '@uni-helper/eslint-config';

export default uniHelper({
  stylistic: {
    'semi': true,
    'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
  },
});
