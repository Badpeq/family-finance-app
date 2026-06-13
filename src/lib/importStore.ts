// Simple singleton para pasar texto OCR entre pantallas sin límite de URL
let _text = '';
let _autoparse = false;

export const importStore = {
  set(text: string, autoparse = false) { _text = text; _autoparse = autoparse; },
  getText()      { return _text; },
  getAutoparse() { return _autoparse; },
  clear()        { _text = ''; _autoparse = false; },
};
