// Prefix for API calls when the app is served below a sub-path such as /roundrobin/.
export const apiPath = (path: string) => import.meta.env.BASE_URL.replace(/\/$/, '') + path
