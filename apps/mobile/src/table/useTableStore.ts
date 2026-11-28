import { getAccessToken } from '../auth/session';
import { config } from '../config';
import { createTableClient } from './tableClient';
import { createTableStore } from './tableStore';

/** The app-wide table store, wired to the real socket client. */
export const useTableStore = createTableStore(
  createTableClient({ url: config.serverUrl, getToken: getAccessToken }),
);
