import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import requests

BASE_URL = "https://cli.windyselfhost.space/"
API_KEY = "truongdeptrai123@"

headers = {
    "x-api-key": API_KEY,
    "Content-Type": "application/json",
}

# Test 1: List models
print("=== Test 1: List Models ===")
resp = requests.get(f"{BASE_URL}/v1/models", headers=headers)
data = resp.json()
for model in data["data"]:
    print(f"  - {model['id']}")

# Test 2: Chat completion
print("\n=== Test 2: Chat Completion ===")
payload = {
    "model": "claude-opus-4-6",
    "messages": [{"role": "user", "content": "Xin chào, 1 + 2 = ?"}],
    "max_tokens": 100,
}
resp = requests.post(f"{BASE_URL}/v1/chat/completions", headers=headers, json=payload)
data = resp.json()
print(f"  Model: {data['model']}")
print(f"  Response: {data['choices'][0]['message']['content']}")
print(f"  Tokens: {data['usage']['total_tokens']}")

print("\nDone! EasyCLI proxy is working.")