import axios from 'axios';
export const api = axios.create({ baseURL: '/api', withCredentials: true });
export const get = async <T = any>(path: string): Promise<T> => (await api.get(path)).data.data;
export function errorMessage(error: unknown) {
  return axios.isAxiosError(error)
    ? (error.response?.data?.error?.message ??
        'Service unavailable. Check that the API and database are running.')
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred';
}
export async function download(path: string, name: string) {
  try {
    const response = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    const serverName = /filename="([^"\r\n]+)"/i.exec(
      response.headers['content-disposition'] ?? '',
    )?.[1];
    link.download = serverName?.split(/[\\/]/).pop() || name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return response.headers['x-template-id'] as string | undefined;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      let detail;
      try {
        detail = JSON.parse(await error.response.data.text());
      } catch {
        /* Fall back to the HTTP error. */
      }
      if (detail?.error?.message) throw new Error(detail.error.message);
    }
    throw error;
  }
}
