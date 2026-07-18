import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type OcrSource = 'camera' | 'gallery';

export async function pickAndOcr(source: OcrSource): Promise<string> {
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

  const base64 = result.assets[0].base64;
  if (!base64) throw new Error('No se pudo leer la imagen.');

  const { data, error } = await supabase.functions.invoke('ocr-ticket', {
    body: { image_base64: base64 },
  });

  if (error) throw new Error(error.message ?? 'Error OCR');

  const { text } = data as { text: string };
  return text;
}
