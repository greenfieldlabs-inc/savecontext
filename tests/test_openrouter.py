"""
Test script for OpenRouter API integration with vision models.
This demonstrates basic text chat before we add image support in Session 2.
"""

import os
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def test_openrouter_text():
    """
    Test basic text chat with Claude 3.5 Sonnet via OpenRouter.
    
    OpenRouter API format (OpenAI-compatible):
    - Endpoint: https://openrouter.ai/api/v1/chat/completions
    - Headers: Authorization, Content-Type
    - Body: model, messages array
    """
    
    # Get API key from environment
    api_key = os.getenv("OPENROUTER_API_KEY")
    
    if not api_key:
        print("❌ Error: OPENROUTER_API_KEY not found in .env file")
        return
    
    # OpenRouter endpoint
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    # Headers for the request
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    # Request body for the API call
    payload = {
        "model": "anthropic/claude-3.5-sonnet",
        "messages": [
            {"role": "user", "content": "Explain what Python decorators are in one sentence."}
        ]
    }
    
    print("🚀 Sending request to OpenRouter...")
    print(f"📝 Model: {payload['model']}")
    
    try:
        # Make the API request
        print("Sending POST request to OpenRouter API...")
        response = requests.post(url, headers=headers, json=payload)
        
        # Check if request was successful
        if response.status_code == 200:
            data = response.json()
            
            # Extract the response text
            # OpenRouter returns: data['choices'][0]['message']['content']
            assistant_message = data['choices'][0]['message']['content']
            
            print("\n✅ Success! Response from Claude 3.5 Sonnet:")
            print("=" * 60)
            print(assistant_message)
            print("=" * 60)
            
            # Show token usage (useful for cost tracking)
            usage = data.get('usage', {})
            print(f"\n📊 Token Usage:")
            print(f"   Input tokens: {usage.get('prompt_tokens', 'N/A')}")
            print(f"   Output tokens: {usage.get('completion_tokens', 'N/A')}")
            print(f"   Total: {usage.get('total_tokens', 'N/A')}")
            
        else:
            print(f"❌ Error: API returned status code {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ Exception occurred: {e}")


if __name__ == "__main__":
    test_openrouter_text()
