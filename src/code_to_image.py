"""
Code to Image Converter
Converts source code files into syntax-highlighted images for vision models.
"""

import os
from pathlib import Path
from pygments import highlight
from pygments.lexers import get_lexer_for_filename, get_lexer_by_name
from pygments.formatters import HtmlFormatter, ImageFormatter
from pygments.styles import get_style_by_name
from PIL import Image, ImageDraw, ImageFont
import io


def get_code_lexer(file_path):
    """
    Get the Pygments lexer for a code file.
    
    Pygments has lexers for 500+ languages. It can detect by:
    - File extension (.py, .js, .tsx, etc.)
    - Filename patterns
    
    Args:
        file_path: Path to the code file
        
    Returns:
        Pygments lexer object
    """
    try:
        # Use get_lexer_for_filename to detect the language based on file extension
        # This will raise an exception if it can't detect the language
        # Pass the file path as a string to get_lexer_for_filename
        lexer = get_lexer_for_filename(str(file_path))
        return lexer
    except Exception as e:
        print(f"⚠️  Could not detect language for {file_path}, defaulting to Python")
        return get_lexer_by_name('python')


def highlight_code_to_html(code, lexer, style='monokai'):
    """
    Convert code to syntax-highlighted HTML.
    
    Pygments workflow:
    1. Lexer breaks code into tokens (keywords, strings, etc.)
    2. Formatter applies style (colors) and generates output format
    3. We use HtmlFormatter with inline styles (CSS embedded in HTML)
    
    Args:
        code: Source code string
        lexer: Pygments lexer object
        style: Color scheme ('monokai', 'github-dark', 'dracula', etc.)
        
    Returns:
        HTML string with syntax highlighting
    """
    # Create HTML formatter with settings optimized for rendering
    formatter = HtmlFormatter(
        style=style,
        full=True,  # Include <html>, <head>, <body> tags
        linenos='inline',  # Show line numbers inline with code
        noclasses=True,  # Use inline CSS (easier to render)
    )
    
    # Generate the HTML string with syntax highlighting
    html = highlight(code, lexer, formatter)

    # The generated HTML includes a lot of boilerplate (DOCTYPE, head, style tags). 
    # For our purposes, we might want to extract just the code part. 
    # However, for now, we'll keep it as is since our html_to_image function will strip tags.
    return html


def parse_html_colors(html_string):
    """
    Parse Pygments HTML to extract text with color information.
    
    Pygments generates HTML like:
    <span style="color: #F92672">def</span>
    <span style="color: #A6E22E">hello</span>
    
    We need to extract: [('def', '#F92672'), ('hello', '#A6E22E')]
    
    Returns:
        List of (text, color) tuples
    """
    from bs4 import BeautifulSoup
    import re
    
    soup = BeautifulSoup(html_string, 'html.parser')
    
    # Find the code container (Pygments wraps code in <pre> or <div class="highlight">)
    code_container = soup.find('pre') or soup.find('div', class_='highlight')
    
    if not code_container:
        # Fallback: use the whole HTML
        code_container = soup
    
    spans = []
    
    # Walk through all elements preserving structure
    for element in code_container.descendants:
        if element.name == 'span' and element.get('style'):
            # Extract color from style attribute
            style = element.get('style', '')
            color_match = re.search(r'color:\s*(#[0-9A-Fa-f]{6})', style)
            color = color_match.group(1) if color_match else '#F8F8F2'
            
            # Get the text content
            text = element.get_text()
            if text:
                spans.append((text, color))
        elif isinstance(element, str):
            # Plain text (not in a span)
            text = str(element)
            if text and text != '\n':
                spans.append((text, '#F8F8F2'))  # Default text color
    
    return spans


def html_to_image(html_string, width=1200):
    """
    Convert syntax-highlighted HTML to a PIL Image with proper colors.
    
    Approach:
    1. Parse HTML to extract text + colors
    2. Render each colored span individually
    3. Handle line breaks and positioning
    
    Args:
        html_string: Syntax-highlighted HTML from Pygments
        width: Image width in pixels (affects token count!)
        
    Returns:
        PIL Image object with proper syntax highlighting
    """
    from bs4 import BeautifulSoup
    import re
    
    # Parse the HTML to get code lines with structure
    soup = BeautifulSoup(html_string, 'html.parser')
    code_container = soup.find('pre') or soup.find('div', class_='highlight')
    
    if not code_container:
        code_container = soup
    
    # Get the raw text to count lines (for image height)
    code_text = code_container.get_text()
    lines = code_text.split('\n')
    
    # Image settings
    line_height = 22
    padding = 40
    font_size = 14
    height = len(lines) * line_height + (padding * 2)
    
    # Create image with dark background
    img = Image.new('RGB', (width, height), color='#272822')
    draw = ImageDraw.Draw(img)
    
    # Load monospace font
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Courier.dfont', font_size)
    except:
        font = ImageFont.load_default()
    
    # Render line by line with colors
    y = padding
    
    for line_num, line_text in enumerate(lines, 1):
        x = padding
        
        # For each line, we need to render spans with their colors
        # This is complex, so let's use a simpler approach:
        # Extract spans for this line from the HTML
        
        # Find all span elements and their text/colors
        current_line_text = ""
        
        # Render the line (we'll do a simpler version: just render with proper color per span)
        # For MVP: render each line with default color (we'll improve this)
        
        # Simple approach: render whole line, then enhance later
        draw.text((x, y), line_text, fill='#F8F8F2', font=font)
        
        y += line_height
    
    return img


def code_to_image(file_path, output_path=None, style='monokai', font_size=14):
    """
    Convert code file to syntax-highlighted image using Pygments ImageFormatter.
    
    Simple approach: Pygments does everything in one step!
    
    Args:
        file_path: Path to code file
        output_path: Where to save image (optional)
        style: Color scheme ('monokai', 'github-dark', 'dracula')
        font_size: Font size for code
        
    Returns:
        PIL Image object with proper syntax highlighting
    """
    print(f"📄 Processing: {file_path}")
    
    # Read file
    code = Path(file_path).read_text()
    print(f"   Read {len(code)} characters")
    
    # Get lexer
    lexer = get_code_lexer(file_path)
    print(f"   Language: {lexer.name}")
    
    # Create formatter
    formatter = ImageFormatter(
        style=style,
        font_name='Courier',
        font_size=font_size,
        line_numbers=True, # Toggle to remove line numbers
    )

    # Returns PNG bytes
    image_bytes = highlight(code, lexer, formatter)
    
    # Convert bytes to PIL Image
    img = Image.open(io.BytesIO(image_bytes))
    print(f"✅ Image: {img.size[0]}x{img.size[1]} pixels")
    
    # Token calculation
    tokens = (img.size[0] * img.size[1]) / 750
    print(f"📊 Tokens: ~{int(tokens)}")

    # Save if requested
    if output_path:
        img.save(output_path)
        print(f"   💾 Saved to: {output_path}")
    
    return img


def test_converter():
    """
    Test the converter with the test_openrouter.py file we created.
    """
    print("🧪 Testing Code to Image Converter\n")
    
    # Use our test script as sample
    test_file = Path(__file__).parent.parent / "tests" / "test_openrouter.py"
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return
    
    # Convert to image
    output = Path(__file__).parent.parent / "outputs" / "test_code_image.png"
    img = code_to_image(str(test_file), str(output))
    
    print(f"\n✅ Test complete! Check {output}")


if __name__ == "__main__":
    test_converter()
