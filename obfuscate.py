"""
Tool Bantu Obfuscate URL & Token untuk config.js (Python)

Penggunaan:
  python obfuscate.py <URL_WEB_APP> <TOKEN>

Contoh:
  python obfuscate.py https://script.google.com/macros/s/.../exec TOKEN_ANDA
"""

import sys
import base64

KEY = 0x5a

def encrypt(s: str, k: int = KEY) -> str:
    raw = ''.join(chr(ord(c) ^ k) for c in s)
    return base64.b64encode(raw.encode('latin1')).decode('ascii')

if len(sys.argv) < 3:
    print("Penggunaan: python obfuscate.py <URL_WEB_APP> <TOKEN>")
    print("Contoh: python obfuscate.py https://script.google.com/macros/s/.../exec TOKEN_ANDA")
    sys.exit(1)

url = sys.argv[1]
token = sys.argv[2]

print("--- HASIL OBFUSCATION UNTUK config.js ---")
print(f"const _O_URL = '{encrypt(url)}';")
print(f"const _O_TOK = '{encrypt(token)}';")
print("-----------------------------------------")
print("Salin dua baris di atas dan tempelkan ke dalam config.js")
