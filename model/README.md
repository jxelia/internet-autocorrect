# Built-in checker model

`distilbert-int8.onnx` and `vocab.txt`: quantised `distilbert-base-uncased` (Apache-2.0, Hugging Face), ONNX export from
`Xenova/distilbert-base-uncased` (`onnx/model_quantized.onnx`). Run by `scorer.js` with ONNX Runtime Web 1.23.0
(`vendor/ort/`, MIT). No training data leaves or enters the extension; nothing is downloaded at run time.
