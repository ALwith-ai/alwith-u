// Vite validates and embeds only the selected environment's public endpoints.
declare const __ALWITH_APP_ENV__: Readonly<{ apiBaseUrl: string; webSsoBaseUrl: string }>

export const appEnv = __ALWITH_APP_ENV__
