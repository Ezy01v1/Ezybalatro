import Constants from 'expo-constants';

interface Extra {
  serverUrl?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  serverUrl:
    process.env.EXPO_PUBLIC_SERVER_URL ?? extra.serverUrl ?? 'https://naipes-server.onrender.com',
  supabaseUrl: extra.supabaseUrl ?? 'https://kptoaakzlikfcxerckxe.supabase.co',
  supabasePublishableKey:
    extra.supabasePublishableKey ?? 'sb_publishable_4wca0i6htZahPVSZV67Kig_rjy_hslu',
};
