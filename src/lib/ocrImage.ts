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
    quality: 0.5,
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

  // Vercel serverless limit is 4.5 MB; base64 adds ~33% overhead
  const estimatedBytes = Math.ceil(base64.length * 0.75);
  if (estimatedBytes > 3_500_000) {
    throw new Error('La foto es demasiado grande. Intenta con una foto más cercana al ticket.');
  }

  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 413) throw new Error('La foto es demasiado grande para procesar. Acércate más al ticket.');
    throw new Error(err.error ?? `Error OCR (${res.status})`);
  }

  const { text } = await res.json() as { text: string };
  return text;
}
