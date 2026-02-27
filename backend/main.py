import os
import io
import json
import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from supabase import create_client, Client
import stripe
import openai
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_SIGNING_SECRET")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
stripe.api_key = STRIPE_SECRET_KEY
openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


# ── Auth ──────────────────────────────────────────────────────────────────────

async def verify_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        user = supabase.auth.get_user(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid user")
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Request models ─────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    input_type: str        # "book_title" | "text_snippet"
    book_title: str = ""
    author: str = ""
    text_snippet: str = ""


# ── LLM ───────────────────────────────────────────────────────────────────────

def extract_quotes_with_llm(req: GenerateRequest) -> list[dict]:
    if req.input_type == "book_title":
        prompt = (
            f'You are a literary expert. For the book "{req.book_title}"'
            f' by {req.author or "unknown author"}, identify 8-10 of the most'
            f" important and memorable quotes.\n\n"
            f"For each quote provide:\n"
            f"1. The exact quote text\n"
            f"2. The literary theme (e.g. symbolism, character arc, foreshadowing, irony, motif)\n"
            f"3. A brief 2-3 sentence analysis of its significance\n\n"
            f"Return ONLY a valid JSON array — no markdown, no extra text:\n"
            f'[{{"quote":"...","theme":"...","analysis":"..."}}]'
        )
    else:
        prompt = (
            f"You are a literary expert. Analyse the following text and identify"
            f" 6-8 quotes that show literary significance.\n\n"
            f"TEXT:\n{req.text_snippet[:4000]}\n\n"
            f"For each quote provide:\n"
            f"1. The exact verbatim quote\n"
            f"2. The literary theme (e.g. symbolism, character arc, foreshadowing, irony, motif)\n"
            f"3. A brief 2-3 sentence analysis of its significance\n\n"
            f"Return ONLY a valid JSON array — no markdown, no extra text:\n"
            f'[{{"quote":"...","theme":"...","analysis":"..."}}]'
        )

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=3000,
    )

    content = response.choices[0].message.content.strip()
    # Strip markdown code fences if the model wraps the JSON
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.rstrip("`").strip()

    return json.loads(content)


# ── PDF ────────────────────────────────────────────────────────────────────────

def generate_pdf(quotes: list[dict], title: str, author: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=72, leftMargin=72,
        topMargin=72, bottomMargin=72,
    )

    styles = getSampleStyleSheet()

    brand_style = ParagraphStyle(
        "Brand", parent=styles["Normal"],
        fontSize=10, textColor=colors.HexColor("#4f46e5"),
        fontName="Helvetica-Bold",
    )
    title_style = ParagraphStyle(
        "CustomTitle", parent=styles["Title"],
        fontSize=24, spaceAfter=4,
        textColor=colors.HexColor("#1a1a2e"),
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontSize=12, spaceAfter=4,
        textColor=colors.HexColor("#6b7280"), fontName="Helvetica-Oblique",
    )
    date_style = ParagraphStyle(
        "Date", parent=styles["Normal"],
        fontSize=9, textColor=colors.HexColor("#9ca3af"),
    )
    theme_style = ParagraphStyle(
        "Theme", parent=styles["Normal"],
        fontSize=9, spaceBefore=14,
        textColor=colors.white, backColor=colors.HexColor("#4f46e5"),
        fontName="Helvetica-Bold", borderPadding=(4, 8, 4, 8),
    )
    quote_style = ParagraphStyle(
        "Quote", parent=styles["Normal"],
        fontSize=12, spaceBefore=8, spaceAfter=8,
        leftIndent=20, rightIndent=20,
        textColor=colors.HexColor("#1e293b"),
        fontName="Helvetica-Oblique",
    )
    analysis_style = ParagraphStyle(
        "Analysis", parent=styles["Normal"],
        fontSize=10, spaceAfter=16,
        textColor=colors.HexColor("#4b5563"),
    )

    story = []
    story.append(Paragraph("QuoteScout", brand_style))
    story.append(Spacer(1, 6))
    story.append(Paragraph(title or "Text Analysis", title_style))
    if author:
        story.append(Paragraph(f"by {author}", subtitle_style))
    story.append(Paragraph(
        datetime.date.today().strftime("%B %d, %Y"), date_style
    ))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#4f46e5")))
    story.append(Spacer(1, 16))

    for i, q in enumerate(quotes, 1):
        story.append(Paragraph(f"Theme: {q.get('theme', 'Literary Device')}", theme_style))
        story.append(Paragraph(f"\u201c{q['quote']}\u201d", quote_style))
        story.append(Paragraph(q.get("analysis", ""), analysis_style))
        if i < len(quotes):
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e7eb")))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/generate-quotes")
async def generate_quotes(req: GenerateRequest, user=Depends(verify_user)):
    user_id = user.user.id

    # Fetch profile
    result = (
        supabase.table("profiles")
        .select("usage_count, is_subscribed")
        .eq("id", user_id)
        .single()
        .execute()
    )
    profile = result.data
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Paywall: free tier = 1 generation
    if profile["usage_count"] >= 1 and not profile["is_subscribed"]:
        raise HTTPException(
            status_code=402,
            detail="Free tier limit reached. Please upgrade to Pro.",
        )

    # Generate quotes
    try:
        quotes = extract_quotes_with_llm(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {e}")

    # Build PDF
    title = req.book_title or "Text Snippet"
    pdf_bytes = generate_pdf(quotes, title, req.author)

    # Persist generation to history
    supabase.table("quote_generations").insert({
        "user_id": user_id,
        "input_type": req.input_type,
        "book_title": req.book_title or None,
        "author": req.author or None,
        "input_text": req.text_snippet[:500] if req.text_snippet else None,
        "quotes_data": quotes,
    }).execute()

    # Increment usage count
    supabase.table("profiles").update({
        "usage_count": profile["usage_count"] + 1
    }).eq("id", user_id).execute()

    filename = f"quotes-{title.replace(' ', '-').lower()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/profile")
async def get_profile(user=Depends(verify_user)):
    user_id = user.user.id
    result = (
        supabase.table("profiles")
        .select("email, usage_count, is_subscribed")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return result.data


@app.get("/history")
async def get_history(user=Depends(verify_user)):
    user_id = user.user.id
    result = (
        supabase.table("quote_generations")
        .select("id, input_type, book_title, author, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    return result.data


@app.post("/create-checkout-session")
async def create_checkout_session(user=Depends(verify_user)):
    user_id = user.user.id
    user_email = user.user.email

    # Get or create Stripe customer
    profile_result = (
        supabase.table("profiles")
        .select("stripe_customer_id")
        .eq("id", user_id)
        .single()
        .execute()
    )
    stripe_customer_id = (
        profile_result.data.get("stripe_customer_id") if profile_result.data else None
    )

    if not stripe_customer_id:
        customer = stripe.Customer.create(
            email=user_email,
            metadata={"supabase_user_id": user_id},
        )
        stripe_customer_id = customer.id
        supabase.table("profiles").update(
            {"stripe_customer_id": stripe_customer_id}
        ).eq("id", user_id).execute()

    try:
        session = stripe.checkout.Session.create(
            customer=stripe_customer_id,
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": "QuoteScout Pro"},
                    "unit_amount": 999,          # $9.99/month
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }],
            success_url=f"{FRONTEND_URL}/dashboard?success=true",
            cancel_url=f"{FRONTEND_URL}/dashboard?canceled=true",
            metadata={"user_id": user_id},
        )
        return {"url": session.url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/stripe-webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook signature verification failed")

    event_type = event["type"]

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session.get("metadata", {}).get("user_id")
        subscription_id = session.get("subscription")
        if user_id:
            supabase.table("profiles").update({
                "is_subscribed": True,
                "stripe_subscription_id": subscription_id,
            }).eq("id", user_id).execute()

    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        if customer_id:
            supabase.table("profiles").update({
                "is_subscribed": False,
                "stripe_subscription_id": None,
            }).eq("stripe_customer_id", customer_id).execute()

    return {"status": "success"}
