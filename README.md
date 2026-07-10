# Obsidian Content Highlight Plugin

> This is an active fork of [chetachi's original Highlightr Plugin](https://github.com/chetachiezikeuzor/Highlightr-Plugin). For details on the original features, demo, and changelog, please reference the original repo.

## What's New in 2.0.0

This fork has been completely overhauled from the ground up to provide a robust, fast, and native Obsidian experience.

### 🚀 Core Optimizations & Features:

- **Native Markdown Syntax (`==text=={Color}`)**: Replaced the invasive `<mark>` HTML injection with clean, native Markdown highlighting. Your notes remain highly legible in raw text and stay fully compatible with Obsidian's core parser.
- **CodeMirror 6 Live Preview**: Implemented a state-of-the-art CodeMirror 6 `ViewPlugin` that renders your highlights seamlessly in real-time Live Preview. No more cursor jumping, Markdown breakage, or text stuttering.
- **Reading View & Export Support**: Integrated a custom `MarkdownPostProcessor` ensuring your highlights look just as beautiful in Reading View and PDF exports.
- **Modern Floating Menu**: The floating toolbar has been redesigned with sleek, customizable circular buttons. It now tracks your selection perfectly, appearing only when needed to keep your workflow fast and uninterrupted.
- **Smart Eraser Tool 🧹**: The highlight removal logic is now incredibly intelligent. You no longer need to perfectly select a highlight to remove it. Simply place your cursor *anywhere inside* a highlight, or drag across multiple overlapping highlights, and click the erase button to cleanly strip the formatting.
- **Flawless Formatting Intersections**: Completely resolved the infamous visual "gaps" (the 1101011 effect) when highlighting text that contains inline code, bold text, or other formatting. The highlights are now completely seamless through the use of advanced CSS negative margins and precise CodeMirror AST character targeting.

## Installation

Download the necessary files and place them within your Obsidian plugins folder, or install via the Obsidian community plugin store if available.
