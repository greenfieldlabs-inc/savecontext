"""
Vision Query System
Send code images to vision models and get intelligent responses.
"""

import os
import base64
import requests
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image
import io

load_dotenv()


def image_to_base64(image_path: str) -> str:
    """
    Convert an image file to base64 string for API transmission.
    
    Process:
    1. Read image file as binary
    2. Encode binary data to base64
    3. Decode to string
    4. Format as data URI
    
    Args:
        image_path: Path to PNG image file
        
    Returns:
        Base64-encoded data URI string
        Example: "data:image/png;base64,iVBORw0KGgo..."
    """
    # Read image file
    with open(image_path, 'rb') as image_file:
        image_data = image_file.read()
    
    # Encode to base64
    base64_encoded = base64.b64encode(image_data)
    
    # Decode to string 
    base64_string = base64_encoded.decode('utf-8')

    # Format as data URI
    data_uri = f"data:image/png;base64,{base64_string}"

    print(f"Image converted to base64 data URI ({len(base64_string)} characters)")
    
    # Data URI format --> Will be passed in OpenRouter API request
    return data_uri


def query_code_image(image_path: str, question: str, model: str = "anthropic/claude-3.5-sonnet") -> dict:
    """
    Query a code image using a vision model via OpenRouter.
    
    This is the main function that ties everything together:
    1. Convert image to base64
    2. Build multimodal message (text + image)
    3. Send to OpenRouter
    4. Parse and return response with metrics
    
    Args:
        image_path: Path to code image
        question: Question to ask about the code
        model: Model to use (default: Claude 3.5 Sonnet)
        
    Returns:
        dict with:
        - response: AI's answer
        - tokens: {input, output, total}
        - cost: Estimated cost in dollars
        - model: Model used
    """
    print(f"Querying image: {Path(image_path).name}")
    print(f"Question: {question}")
    
    # Get API key
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not found in .env")

    # Convert image to base64 data URI
    image_data_uri = image_to_base64(image_path)

    print(f"🔥 Image encoded, sending to {model}...")
    
    # OpenRouter endpoint
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    # Headers
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Build multimodal message payload
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {"type": "image_url", "image_url": {"url": image_data_uri}}
                ]
            }
        ]
    }
    # Print payload for debugging
    print(f"Payload ready, sending request...")
    print(f"Model: {model}")
    print(f"Image size: {Path(image_path).stat().st_size / 1024:.2f} KB")
    print(f"Question length: {len(question)} characters")


    # Make API request
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        
        # Extract response
        assistant_message = data['choices'][0]['message']['content']
        
        # Extract token usage
        usage = data.get('usage', {})
        input_tokens = usage.get('prompt_tokens', 0)
        output_tokens = usage.get('completion_tokens', 0)
        total_tokens = usage.get('total_tokens', 0)
        
        # Estimate cost (approximate for Claude 3.5 Sonnet)
        # Input: $3 per 1M tokens, Output: $15 per 1M tokens
        cost = (input_tokens * 3 / 1_000_000) + (output_tokens * 15 / 1_000_000)
        
        print(f"\n✅ Response received!")
        print(f"Tokens: {input_tokens} input + {output_tokens} output = {total_tokens} total")
        print(f"Estimated cost: ${cost:.4f}")
        
        return {
            'response': assistant_message,
            'tokens': {
                'input': input_tokens,
                'output': output_tokens,
                'total': total_tokens
            },
            'cost': cost,
            'model': model
        }
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Error querying API: {e}")
        if hasattr(e.response, 'text'):
            print(f"Response: {e.response.text}")
        raise


def test_vision_queries():
    """
    Test the vision query system with our generated code image.
    Ask 5 different questions to see how well Claude "reads" the code.
    """
    print("🧪 Testing Vision Query System\n")
    print("=" * 60)
    
    # Path to the image we generated in Session 2
    image_path = Path(__file__).parent.parent / "outputs" / "test_code_image.png"
    
    if not image_path.exists():
        print(f"❌ Image not found: {image_path}")
        print("Run code_to_image.py first to generate the test image!")
        return
    
    print(f"📸 Using image: {image_path}\n")
    
    # Define test questions
    questions = [
        "What does this code do? Give a brief summary.",
        "Where is the API key loaded from?",
        "How does error handling work in this code?",
        "What library is used for HTTP requests?",
        "Explain the main function flow step by step."
    ]
    
    # Run each query
    results = []
    total_cost = 0
    
    for i, question in enumerate(questions, 1):
        print(f"\n{'='*60}")
        print(f"Question {i}/{len(questions)}")
        print(f"{'='*60}")
        
        try:
            result = query_code_image(str(image_path), question)
            results.append({
                'question': question,
                'answer': result['response'],
                'tokens': result['tokens'],
                'cost': result['cost']
            })
            total_cost += result['cost']
            
            print(f"\n💬 Answer:")
            print(result['response'])
            
        except Exception as e:
            print(f"❌ Failed: {e}")
            continue
    
    # Summary
    print(f"\n\n{'='*60}")
    print("📊 SUMMARY")
    print(f"{'='*60}")
    print(f"Questions asked: {len(results)}")
    print(f"Total cost: ${total_cost:.4f}")
    print(f"Average cost per query: ${total_cost/len(results):.4f}")
    
    total_input = sum(r['tokens']['input'] for r in results)
    total_output = sum(r['tokens']['output'] for r in results)
    print(f"Total tokens: {total_input} input + {total_output} output")
    
    # Save results
    import json
    output_file = Path(__file__).parent.parent / "outputs" / "vision_query_results.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n💾 Results saved to: {output_file}")


if __name__ == "__main__":
    test_vision_queries()
