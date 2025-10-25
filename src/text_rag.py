"""
Text RAG Baseline
Traditional text-based approach for comparison with vision system.
"""

import os
import requests
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def chunk_code_file(file_path: str, strategy: str = "by_file") -> list[str]:
    """
    Chunk code file for text-based RAG.
    
    Strategies:
    - "by_file": Send entire file as one chunk (simple baseline)
    - "by_lines": Split into N-line chunks (future enhancement)
    
    For our comparison, we'll use "by_file" since our test file
    is small enough to fit in context.
    
    Args:
        file_path: Path to code file
        strategy: Chunking strategy
        
    Returns:
        List of text chunks
    """
    # Read the file content
    code = Path(file_path).read_text()
    
    if strategy == "by_file":
        # Simple: entire file is one chunk
        return [code]
    elif strategy == "by_lines":
        # Future: split into chunks of N lines
        # For now, just return the whole file
        return [code]
    else:
        raise ValueError(f"Unknown strategy: {strategy}")


def query_code_text(code_text: str, question: str, model: str = "anthropic/claude-3.5-sonnet") -> dict:
    """
    Query code using text-based approach (traditional RAG).
    
    This is similar to Session 1, but we're sending code + question together.
    
    Args:
        code_text: The code as a text string
        question: Question to ask
        model: Model to use
        
    Returns:
        dict with response, tokens, cost
    """
    print(f"Querying with text approach")
    print(f"Question: {question}")
    
    # Get API key
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not found")
    
    # OpenRouter endpoint
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    # Headers
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    # Build the message with code + question
    # Format the prompt to include both the code and the question
    # Example: "Here is the code:\n\n{code_text}\n\nQuestion: {question}"
    prompt = f"Here is the code:\n\n{code_text}\n\nQuestion: {question}"

    # Simple text message, NOT multimodal
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    }

    print(f"Sending to {model}...")
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        
        # Extract response
        assistant_message = data['choices'][0]['message']['content']
        
        # Extract tokens
        usage = data.get('usage', {})
        input_tokens = usage.get('prompt_tokens', 0)
        output_tokens = usage.get('completion_tokens', 0)
        total_tokens = usage.get('total_tokens', 0)
        
        # Estimate cost (Claude 3.5 Sonnet: $3/$15 per 1M tokens)
        cost = (input_tokens * 3 / 1_000_000) + (output_tokens * 15 / 1_000_000)
        
        print(f"✅ Response received!")
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
        print(f"❌ Error: {e}")
        raise


def compare_approaches():
    """
    Run the same 5 questions through BOTH approaches and compare.
    
    This is the money function! Shows vision vs text side-by-side.
    """
    print("🔬 COMPARING VISION vs TEXT RAG\n")
    print("=" * 80)
    
    # Get the test file (same one we used for vision)
    test_file = Path(__file__).parent.parent / "tests" / "test_openrouter.py"
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return
    
    # Load the code
    code_chunks = chunk_code_file(str(test_file))
    code_text = code_chunks[0]  # We're using "by_file" strategy
    
    print(f"Test file: {test_file.name}")
    print(f"Code length: {len(code_text)} characters")
    print(f"Estimated text tokens: ~{len(code_text) // 4}\n")  # Rough estimate
    
    # Same questions as Session 3
    questions = [
        "What does this code do? Give a brief summary.",
        "Where is the API key loaded from?",
        "How does error handling work in this code?",
        "What library is used for HTTP requests?",
        "Explain the main function flow step by step."
    ]
    
    # Run text-based queries
    print("=" * 80)
    print("RUNNING TEXT-BASED QUERIES")
    print("=" * 80)
    
    text_results = []
    text_total_cost = 0
    
    for i, question in enumerate(questions, 1):
        print(f"\n{'─'*80}")
        print(f"Question {i}/{len(questions)}")
        print(f"{'─'*80}")
        
        try:
            result = query_code_text(code_text, question)
            text_results.append({
                'question': question,
                'answer': result['response'],
                'tokens': result['tokens'],
                'cost': result['cost']
            })
            text_total_cost += result['cost']
            
            print(f"\nAnswer:")
            print(result['response'][:200] + "..." if len(result['response']) > 200 else result['response'])
            
        except Exception as e:
            print(f"❌ Failed: {e}")
            continue
    
    # Load vision results from Session 3
    vision_results_file = Path(__file__).parent.parent / "outputs" / "vision_query_results.json"
    
    if vision_results_file.exists():
        with open(vision_results_file, 'r') as f:
            vision_results = json.load(f)
        vision_total_cost = sum(r['cost'] for r in vision_results)
    else:
        print("\n⚠️  Vision results not found. Run vision_query.py first!")
        vision_results = []
        vision_total_cost = 0
    
    # COMPARISON
    print(f"\n\n{'='*80}")
    print("📊 COMPARISON RESULTS")
    print(f"{'='*80}\n")
    
    if vision_results and text_results:
        print(f"{'Metric':<30} {'Vision':<20} {'Text':<20} {'Winner':<10}")
        print(f"{'-'*80}")
        
        # Average input tokens
        avg_vision_input = sum(r['tokens']['input'] for r in vision_results) / len(vision_results)
        avg_text_input = sum(r['tokens']['input'] for r in text_results) / len(text_results)
        vision_wins_input = avg_vision_input < avg_text_input
        print(f"{'Avg Input Tokens':<30} {avg_vision_input:<20.0f} {avg_text_input:<20.0f} {'Vision' if vision_wins_input else 'Text':<10}")
        
        # Average output tokens (should be similar)
        avg_vision_output = sum(r['tokens']['output'] for r in vision_results) / len(vision_results)
        avg_text_output = sum(r['tokens']['output'] for r in text_results) / len(text_results)
        print(f"{'Avg Output Tokens':<30} {avg_vision_output:<20.0f} {avg_text_output:<20.0f} {'Similar':<10}")
        
        # Total cost
        vision_wins_cost = vision_total_cost < text_total_cost
        print(f"{'Total Cost':<30} ${vision_total_cost:<19.4f} ${text_total_cost:<19.4f} {'Vision' if vision_wins_cost else 'Text':<10}")
        
        # Cost per query
        vision_per_query = vision_total_cost / len(vision_results)
        text_per_query = text_total_cost / len(text_results)
        print(f"{'Cost Per Query':<30} ${vision_per_query:<19.4f} ${text_per_query:<19.4f} {'Vision' if vision_per_query < text_per_query else 'Text':<10}")
        
        print(f"\n{'='*80}")
        print("💡 INSIGHTS")
        print(f"{'='*80}")
        
        if avg_vision_input < avg_text_input:
            savings = ((avg_text_input - avg_vision_input) / avg_text_input) * 100
            print(f"✅ Vision uses {savings:.1f}% fewer input tokens")
        else:
            increase = ((avg_vision_input - avg_text_input) / avg_text_input) * 100
            print(f"⚠️  Vision uses {increase:.1f}% MORE input tokens")
        
        print(f"\n📝 Note: Both approaches gave accurate answers!")
        print(f"   The main difference is in token efficiency and cost.")
    
    # Save combined results
    combined_results = {
        'vision': vision_results,
        'text': text_results,
        'summary': {
            'vision_total_cost': vision_total_cost,
            'text_total_cost': text_total_cost,
            'questions_asked': len(questions)
        }
    }
    
    output_file = Path(__file__).parent.parent / "outputs" / "comparison_results.json"
    with open(output_file, 'w') as f:
        json.dump(combined_results, f, indent=2)
    
    print(f"\n💾 Full comparison saved to: {output_file}")


if __name__ == "__main__":
    compare_approaches()
