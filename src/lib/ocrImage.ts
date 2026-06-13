import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

// Absolute URL so it works from native devices too
const OCR_ENDPOINT = 'https://family-finance-app-ruby.vercel.app/api/ocr';

export type OcrSource = 'camera' | 'gallery';

export async function pickAndOcr(source: OcrSource): Promise<string> {
  // Request permissions on native
  if (Platform.OS !== 'web') {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') throw new Error('Permiso de cámara denegado.');
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') throw new Error('Permiso de galería denegado.');
    }
  }

  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.85,
    base64: true,
    allowsEditing: false,
  };

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled) throw new Error('cancelled');

  const asset = result.assets[0];
  const base64 = asset.base64;

  if (!base64) throw new Error('No se pudo leer la imagen.');

  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Error OCR (${res.status})`);
  }

  const { text } = await res.json() as { text: string };
  return text;
}
