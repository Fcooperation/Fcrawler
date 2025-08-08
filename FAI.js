# backend.py
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

app = FastAPI()

# Path to your local Google Drive model folder
MODEL_PATH = "/content/drive/MyDrive/gemma-2b"

print("Loading model and tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_PATH,
    torch_dtype=torch.float16,
    device_map="auto"
)
print("Model loaded successfully.")

class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
def chat_with_model(req: ChatRequest):
    inputs = tokenizer(req.message, return_tensors="pt").to(model.device)
    outputs = model.generate(**inputs, max_new_tokens=150)
    reply = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return {"reply": reply}

# Run: uvicorn backend:app --host 0.0.0.0 --port 8000
