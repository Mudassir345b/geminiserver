# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# architecture
- The baby-hero-edit pipeline must accept a costume_image from the user (not generate costumes from text prompts alone) because the same pipeline will be reused for many different costume types (superhero, funky, etc.). Confidence: 0.70

# image-processing
- Prefer AI-based compositing (e.g., Gemini) over sharp composite for blending the dressed baby back into the original image — sharp composite produces hard edges and poor quality results. Confidence: 0.70

# code-organization
- Keep backup/experimental API routes in separate files, but document them alongside the main routes in the same API docs. Confidence: 0.65

# detection
- Avoid hardcoded positional heuristics (e.g., fixed-percentage center crops) for detecting baby position in family photos — rely on AI-based detection rather than assuming the baby is in a particular region. Confidence: 0.70
