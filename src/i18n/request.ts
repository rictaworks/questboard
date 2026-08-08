import {getRequestConfig} from 'next-intl/server';

import messages from '../messages/ja.json';

import {defaultLocale} from './routing';

// ロケールは常に日本語。URL・クッキー・Accept-Language のいずれも参照しない。
//
// メッセージは動的 import ではなく静的 import で読む。候補が1つしかないため
// 動的にする理由が無く、静的にすることでビルド時に解決され、存在しない
// メッセージファイルを参照した場合はビルドが失敗する。
export default getRequestConfig(async () => {
  return {
    locale: defaultLocale,
    messages
  };
});
