// Singleton para pasar texto OCR + metadatos entre pantallas
let _text      = '';
let _autoparse = false;
let _mode: 'voucher' | 'ticket' = 'ticket';

export const importStore = {
  set(text: string, autoparse = false, mode: 'voucher' | 'ticket' = 'ticket') {
    _text      = text;
    _autoparse = autoparse;
    _mode      = mode;
  },
  getText()      { return _text; },
  getAutoparse() { return _autoparse; },
  getMode()      { return _mode; },
  clear()        { _text = ''; _autoparse = false; _mode = 'ticket'; },
};
