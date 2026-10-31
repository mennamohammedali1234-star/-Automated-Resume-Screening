"""
Automated Resume Screening - Web Application
Flask backend serving an interactive UI for screening and ranking resumes.
"""

import os
import sys
from flask import Flask, render_template, request, jsonify
from main import rank_resumes, screen_candidates
from resume_parser import extract_text_from_file, analyze_keyword_matches
from voice_service import process_voice_command, generate_audio_speech, transcribe_audio_file

# Ensure UTF-8 output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB max upload

PRESET_JOBS = [
    {
        "id": "data-engineer",
        "title": "Data Engineer (Spark, Airflow, Kafka, ETL, SQL)",
        "job_desc": (
            "We are seeking an experienced Data Engineer to design, build and maintain scalable ETL data pipelines.\n"
            "Requirements:\n"
            "- Hands-on experience with Apache Airflow, Apache Spark / PySpark, and Kafka\n"
            "- Strong proficiency in Python and SQL (PostgreSQL, BigQuery, Snowflake)\n"
            "- Experience building automated data pipelines, data warehousing, and ETL architectures\n"
            "- Knowledge of cloud infrastructure (AWS or GCP), Docker, and Git version control"
        ),
        "candidates": [
            {
                "name": "Mazen Abd Elraheem",
                "text": "Data Engineer with 4 years experience building automated ETL data pipelines using PySpark, Kafka streaming, and Airflow orchestration. Expert in PostgreSQL, SQL data warehousing, and AWS cloud services. Proficient in Docker and Git."
            },
            {
                "name": "Sarah Al-Mansoor",
                "text": "Machine Learning Engineer with 5 years experience in Python, scikit-learn, pandas, NumPy, and Flask REST APIs. Skilled in PostgreSQL, Git, and Docker."
            },
            {
                "name": "Alex Rivera",
                "text": "Lead Frontend Developer specializing in React, Next.js, TypeScript, and modern CSS. No data engineering or distributed computing background."
            }
        ]
    },
    {
        "id": "ml-python",
        "title": "Python & Machine Learning Engineer",
        "job_desc": (
            "We are seeking an experienced Python Developer with machine learning expertise.\n"
            "Requirements:\n"
            "- Strong proficiency in Python, scikit-learn, pandas, and NumPy\n"
            "- Experience building REST APIs using Flask or FastAPI\n"
            "- Knowledge of SQL databases (PostgreSQL/MySQL) and Git version control\n"
            "- Exposure to Docker containerization and cloud deployments is a plus"
        ),
        "candidates": [
            {
                "name": "Piyush",
                "text": "Python developer with 3 years of experience. Skilled in scikit-learn, pandas, NumPy and Flask. Built multiple RESTful APIs. Familiar with PostgreSQL and version control with Git."
            },
            {
                "name": "Riya",
                "text": "Full-stack Python developer. Uses Flask, scikit-learn, pandas, and NumPy daily. Strong SQL skills, active Git user, builds data pipelines."
            },
            {
                "name": "Suchak",
                "text": "Data scientist with expertise in machine learning, TensorFlow, pandas, and NumPy. Published research in NLP. Comfortable with Python and Git."
            },
            {
                "name": "Nikhil",
                "text": "Java backend developer with Spring Boot. Limited Python experience. Worked with SQL databases and REST APIs extensively."
            },
            {
                "name": "Tippsy",
                "text": "Front-end developer experienced in React, JavaScript, HTML and CSS. Some Python scripting knowledge. No machine learning background."
            }
        ]
    },
    {
        "id": "frontend-react",
        "title": "Senior Frontend React Developer",
        "job_desc": (
            "Looking for a Senior Frontend Developer to lead client web development.\n"
            "Requirements:\n"
            "- Expert in React, TypeScript, Next.js, and modern JavaScript (ES6+)\n"
            "- Proficient in Tailwind CSS, responsive layouts, and UI animations\n"
            "- Experience with state management (Redux / Zustand) and REST API integration\n"
            "- Familiarity with Git, automated testing (Jest/Cypress), and CI/CD"
        ),
        "candidates": [
            {
                "name": "Alex Rivera",
                "text": "Lead Frontend Developer with 4 years in React, Next.js, TypeScript, and Tailwind CSS. Built responsive web applications and integrated REST APIs."
            },
            {
                "name": "Tariq Aziz",
                "text": "Full-stack engineer with React, Node.js, Express, MongoDB, and basic TypeScript knowledge. Experienced in building responsive landing pages."
            },
            {
                "name": "Sarah Al-Mansoor",
                "text": "Machine Learning Engineer specializing in Python, TensorFlow, scikit-learn, pandas, and data visualization. Basic HTML/CSS knowledge."
            }
        ]
    }
]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/presets", methods=["GET"])
def get_presets():
    return jsonify(PRESET_JOBS)


def format_enriched_results(detailed_candidates, resumes):
    """Format screened candidates into detailed frontend presentation dicts."""
    results = []
    for rank, c in enumerate(detailed_candidates, start=1):
        name = c["name"]
        score = c["score"]
        resume_text = resumes.get(name, "")
        snippet = resume_text[:220] + ("..." if len(resume_text) > 220 else "")

        # Tier categorization (Calibrated Realistic Ranges)
        if score >= 0.65:
            tier = "high"
            badge = "🌟 High Match"
        elif score >= 0.35:
            tier = "medium"
            badge = "👍 Moderate Fit"
        else:
            tier = "low"
            badge = "⚠️ Low Match"

        results.append({
            "rank": rank,
            "name": name,
            "score": round(float(score), 4),
            "score_percent": f"{score * 100:.1f}%",
            "skill_match_percent": f"{c.get('skill_score', score) * 100:.1f}%",
            "context_match_percent": f"{c.get('context_score', score) * 100:.1f}%",
            "skills_ratio": f"{c.get('matched_count', 0)} of {c.get('total_competencies', 0)} skills found",
            "tier": tier,
            "badge": badge,
            "matched_keywords": c.get("matched", [])[:15],
            "missing_keywords": c.get("missing", [])[:15],
            "negated_keywords": c.get("negated", [])[:10],
            "snippet": snippet,
            "char_count": len(resume_text)
        })
    return results


@app.route("/api/screen", methods=["POST"])
def screen_resumes():
    try:
        # Check if form data or JSON
        if request.is_json:
            data = request.get_json()
            job_desc = data.get("job_description", "").strip()
            raw_candidates = data.get("candidates", [])
            resumes = {}
            for c in raw_candidates:
                name = c.get("name", "").strip()
                text = c.get("text", "").strip()
                if name and text:
                    resumes[name] = text
        else:
            job_desc = request.form.get("job_description", "").strip()
            resumes = {}

            # Parse text candidates
            names = request.form.getlist("candidate_names[]")
            texts = request.form.getlist("candidate_texts[]")
            for name, text in zip(names, texts):
                if name.strip() and text.strip():
                    resumes[name.strip()] = text.strip()

            # Parse uploaded files (.pdf, .docx, .txt)
            files = request.files.getlist("files[]")
            for file in files:
                if file and file.filename:
                    fname = file.filename
                    cand_name = os.path.splitext(fname)[0]
                    extracted_text = extract_text_from_file(file, fname)
                    if extracted_text.strip():
                        resumes[cand_name] = extracted_text

        if not job_desc:
            return jsonify({"error": "Job description cannot be empty."}), 400

        if not resumes:
            return jsonify({"error": "Please provide at least one candidate resume or upload a file."}), 400

        # Run Universal Screening Engine
        detailed_candidates = screen_candidates(job_desc, resumes)
        results = format_enriched_results(detailed_candidates, resumes)

        return jsonify({
            "success": True,
            "total_candidates": len(results),
            "top_candidate": results[0]["name"] if results else None,
            "ranked": results
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/voice/interact", methods=["POST"])
def voice_interact():
    """
    Accepts user audio recording (or voice text fallback), transcribes it,
    understands intent (screen candidates, update job description, load preset, query),
    executes action, and returns both text and audio recording response (record back to user).
    """
    try:
        # 1. Extract audio if provided
        audio_file = None
        if "audio" in request.files:
            audio_file = request.files["audio"]
        elif "file" in request.files:
            audio_file = request.files["file"]

        # 2. Extract fallback text or language
        fallback_text = ""
        language = "auto"
        job_desc = ""
        resumes = {}

        if request.is_json:
            data = request.get_json() or {}
            fallback_text = data.get("text", data.get("fallback_text", ""))
            language = data.get("language", "auto")
            job_desc = data.get("job_description", "").strip()
            candidates = data.get("candidates", [])
            for c in candidates:
                n = c.get("name", "").strip()
                t = c.get("text", "").strip()
                if n and t:
                    resumes[n] = t
        else:
            fallback_text = request.form.get("text", request.form.get("fallback_text", "")).strip()
            language = request.form.get("language", "auto")
            job_desc = request.form.get("job_description", "").strip()

            # Parse text candidates
            names = request.form.getlist("candidate_names[]")
            texts = request.form.getlist("candidate_texts[]")
            for name, text in zip(names, texts):
                if name.strip() and text.strip():
                    resumes[name.strip()] = text.strip()

        # If candidates are empty but preset was specified or default can be used
        if not resumes and not job_desc:
            # Check default preset
            default_p = PRESET_JOBS[0]
            job_desc = default_p["job_desc"]
            resumes = {c["name"]: c["text"] for c in default_p["candidates"]}

        # Process voice interaction
        voice_result = process_voice_command(
            audio_file_or_bytes=audio_file,
            fallback_text=fallback_text,
            current_job_desc=job_desc,
            current_candidates=resumes,
            language=language
        )

        response_payload = {
            "success": voice_result.get("success", False),
            "transcribed_text": voice_result.get("transcribed_text", ""),
            "response_text": voice_result.get("response_text", ""),
            "audio_base64": voice_result.get("audio_base64"),
            "audio_format": voice_result.get("audio_format", "mp3"),
            "action": voice_result.get("action", "none"),
            "action_data": voice_result.get("action_data", {})
        }

        # If action was screen, enrich ranking results for frontend leaderboard
        if voice_result.get("action") == "screen":
            action_data = voice_result.get("action_data", {})
            detailed_candidates = action_data.get("ranked", [])
            enriched = format_enriched_results(detailed_candidates, resumes)
            response_payload["ranked"] = enriched
            response_payload["total_candidates"] = len(enriched)
            response_payload["top_candidate"] = enriched[0]["name"] if enriched else None

        return jsonify(response_payload)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/voice/speak", methods=["POST"])
def voice_speak():
    """
    Generate speech audio for any given text.
    Returns base64 audio data URI.
    """
    try:
        data = request.get_json() if request.is_json else request.form
        text = (data.get("text") or "").strip()
        language = data.get("language", "en")

        if not text:
            return jsonify({"success": False, "error": "No text provided."}), 400

        result = generate_audio_speech(text, language=language)
        return jsonify(result)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/voice/transcribe", methods=["POST"])
def voice_transcribe():
    """
    Transcribe an uploaded audio recording into text.
    """
    try:
        audio_file = request.files.get("audio") or request.files.get("file")
        if not audio_file:
            return jsonify({"success": False, "error": "No audio file provided."}), 400

        language = request.form.get("language", "auto")
        result = transcribe_audio_file(audio_file, language=language)
        return jsonify(result)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  🚀 Resume Screening Web App starting on http://127.0.0.1:5000")
    print("=" * 60 + "\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
