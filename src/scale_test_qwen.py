"""
Scale Test with Qwen2.5-VL
Test the large files that failed with Claude using Qwen's large-image model.
"""

import json
import time
from pathlib import Path
from code_to_image import code_to_image
from vision_query import query_code_image


def test_qwen_at_scale():
    """
    Test Qwen2.5-VL 72B on the large files that failed with Claude.
    """
    print("QWEN2.5-VL SCALE TEST")
    print("Testing files that exceeded Claude's 8000px limit")
    print("="*80)
    
    fastapi_root = Path(__file__).parent.parent / "test_repos" / "fastapi" / "fastapi"
    
    # Files that FAILED with Claude (1000+ lines)
    test_files = [
        {
            'path': fastapi_root / "dependencies" / "utils.py",
            'lines': 1053,
            'expected_pixels': 13696,
        },
        {
            'path': fastapi_root / "param_functions.py",
            'lines': 2362,
            'expected_pixels': 30713,
        },
    ]
    
    # Qwen models to test
    qwen_models = [
        "qwen/qwen-2-vl-72b-instruct",  # 72B parameter model
        # "qwen/qwen3-vl-32b-instruct",   # Newer 32B model (if you want to compare)
    ]
    
    all_results = []
    
    for file_info in test_files:
        file_path = file_info['path']
        
        if not file_path.exists():
            print(f"\nFile not found: {file_path}")
            continue
        
        print(f"\n{'='*80}")
        print(f"FILE: {file_path.name}")
        print(f"Lines: {file_info['lines']}, Expected height: {file_info['expected_pixels']}px")
        print(f"{'='*80}")
        
        # Generate image
        print("\n[1] Generating image...")
        image_output = Path(__file__).parent.parent / "outputs" / f"qwen_test_{file_path.stem}.png"
        
        try:
            img = code_to_image(str(file_path), str(image_output))
            print(f"Success! Image: {img.size[0]}x{img.size[1]} pixels")
        except Exception as e:
            print(f"Image generation failed: {e}")
            continue
        
        # Test with Qwen models
        for model in qwen_models:
            print(f"\n[2] Testing with {model}...")
            
            try:
                start = time.time()
                result = query_code_image(
                    str(image_output),
                    "What does this code do? Summarize the main functionality in 2-3 sentences.",
                    model=model
                )
                query_time = time.time() - start
                
                print(f"\nSuccess!")
                print(f"Tokens: {result['tokens']['input']} input + {result['tokens']['output']} output")
                print(f"Cost: ${result['cost']:.4f}")
                print(f"Time: {query_time:.2f}s")
                print(f"\nResponse preview:")
                print(result['response'][:200] + "...")
                
                all_results.append({
                    'file': str(file_path),
                    'lines': file_info['lines'],
                    'image_size': f"{img.size[0]}x{img.size[1]}",
                    'model': model,
                    'tokens': result['tokens'],
                    'cost': result['cost'],
                    'query_time': query_time,
                    'success': True,
                })
                
            except Exception as e:
                print(f"Query failed: {e}")
                all_results.append({
                    'file': str(file_path),
                    'lines': file_info['lines'],
                    'model': model,
                    'error': str(e),
                    'success': False,
                })
        
        time.sleep(2)
    
    # Save results
    output_file = Path(__file__).parent.parent / "outputs" / "qwen_scale_results.json"
    with open(output_file, 'w') as f:
        json.dump(all_results, f, indent=2)
    
    # Summary
    print(f"\n\n{'='*80}")
    print("SUMMARY: Qwen2.5-VL Performance on Large Files")
    print(f"{'='*80}\n")
    
    successful = [r for r in all_results if r.get('success')]
    failed = [r for r in all_results if not r.get('success')]
    
    if successful:
        print(f"Successful: {len(successful)}/{len(all_results)}")
        print(f"\n{'File':<30} {'Lines':<8} {'Tokens':<10} {'Cost':<10}")
        print("-" * 80)
        for r in successful:
            file_name = Path(r['file']).name
            tokens = r['tokens']['input']
            cost = f"${r['cost']:.4f}"
            print(f"{file_name:<30} {r['lines']:<8} {tokens:<10} {cost:<10}")
        
        avg_cost = sum(r['cost'] for r in successful) / len(successful)
        print(f"\nAverage cost per query: ${avg_cost:.4f}")
    
    if failed:
        print(f"\nFailed: {len(failed)}/{len(all_results)}")
        for r in failed:
            print(f"  - {Path(r['file']).name}: {r.get('error', 'Unknown error')}")
    
    print(f"\nFull results: {output_file}")


if __name__ == "__main__":
    test_qwen_at_scale()
