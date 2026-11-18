# Third-party files

These files are not covered by `LICENSE`; each keeps its own license.

| Files | What | License |
|---|---|---|
| `model/distilbert-int8.onnx`, `model/vocab.txt` | Quantised [distilbert-base-uncased](https://huggingface.co/distilbert/distilbert-base-uncased), ONNX export from [Xenova/distilbert-base-uncased](https://huggingface.co/Xenova/distilbert-base-uncased) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| `vendor/ort/` | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.23.0 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), Copyright (c) Microsoft Corporation |
| `data/words.txt`, `data/regional.txt` (built from) | [SCOWL](http://wordlist.aspell.net/) word lists, via the `wordlist-english` package | [SCOWL license](http://wordlist.aspell.net/scowl-readme/), Copyright Kevin Atkinson and others |
