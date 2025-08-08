from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

# Initialize FastAPI app
app = FastAPI()

# Path to your local Google Drive model folder
MODEL_PATH = "/content/drive/MyDrive/gemma-2b"

print("🚀 Loading model and tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_PATH,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    device_map="auto"
)
print("✅ Model loaded successfully.")

# Define request format
class ChatRequest(BaseModel):
    message: str

# Chat endpoint
@app.post("/chat")
def chat_with_model(req: ChatRequest):
    inputs = tokenizer(req.message, return_tensors="pt").to(model.device)
    outputs = model.generate(**inputs, max_new_tokens=150)
    reply = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return {"reply": reply}
