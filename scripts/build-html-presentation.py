#!/usr/bin/env python3
"""Build an HTML presentation from scraped TikTok AI trends data."""

import json
import os
import base64

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_FILE = os.path.join(PROJECT_DIR, "outputs", "tiktok-ai-raw.json")
THUMB_DIR = os.path.join(PROJECT_DIR, "outputs", "thumbs")
OUTPUT_FILE = os.path.join(PROJECT_DIR, "outputs", "TikTok_AI_Trends_March2026.html")


def fmt_num(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}K"
    return str(n)


def get_thumb_data_uri(video_id):
    path = os.path.join(THUMB_DIR, f"thumb_{video_id}.jpg")
    if os.path.exists(path):
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        return f"data:image/jpeg;base64,{b64}"
    return None


def build_video_card(v, rank):
    author = v.get("authorMeta", {}).get("name", "Unknown")
    views = v.get("playCount", 0)
    likes = v.get("diggCount", 0)
    comments = v.get("commentCount", 0)
    shares = v.get("shareCount", 0)
    caption = v.get("text", "")[:120]
    url = v.get("webVideoUrl", "")
    vid = v.get("id", "")
    thumb = get_thumb_data_uri(vid)

    thumb_html = f'<img src="{thumb}" class="thumb">' if thumb else '<div class="thumb-placeholder">No thumbnail</div>'

    return f'''
    <div class="video-card">
      <div class="rank">#{rank}</div>
      <a href="{url}" target="_blank" class="thumb-link">{thumb_html}</a>
      <div class="card-body">
        <div class="author">@{author}</div>
        <div class="metrics">
          <span class="views">{fmt_num(views)} views</span>
          <span class="likes">{fmt_num(likes)} likes</span>
          <span class="comments">{fmt_num(comments)} comments</span>
        </div>
        <div class="caption">{caption}</div>
      </div>
    </div>'''


def main():
    with open(DATA_FILE) as f:
        videos = json.load(f)
    videos.sort(key=lambda v: v.get("playCount", 0), reverse=True)
    top20 = videos[:20]

    # Build video cards HTML
    cards_top5 = "\n".join(build_video_card(v, i+1) for i, v in enumerate(top20[:5]))
    cards_6_10 = "\n".join(build_video_card(v, i+6) for i, v in enumerate(top20[5:10]))
    cards_11_15 = "\n".join(build_video_card(v, i+11) for i, v in enumerate(top20[10:15]))

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TikTok AI Trends - March 2026</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&display=swap');

  * {{ margin: 0; padding: 0; box-sizing: border-box; }}

  :root {{
    --bg: #0a0a0a;
    --bg-card: #141425;
    --bg-card-hover: #1a1a35;
    --pink: #FE2C55;
    --cyan: #25F4EE;
    --purple: #A855F7;
    --green: #10B981;
    --yellow: #FFD700;
    --orange: #FF6934;
    --white: #ffffff;
    --gray: #888;
    --light-gray: #ccc;
  }}

  body {{
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--white);
    overflow-x: hidden;
  }}

  /* SLIDE SYSTEM */
  .slide {{
    min-height: 100vh;
    padding: 60px 80px;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }}

  .slide::before {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--cyan), var(--pink), var(--purple));
  }}

  .slide-number {{
    position: absolute;
    bottom: 30px;
    right: 60px;
    font-size: 14px;
    color: var(--gray);
    font-weight: 300;
  }}

  /* TITLE SLIDE */
  .title-slide {{
    text-align: center;
    background: radial-gradient(ellipse at 50% 30%, #1a1a3a 0%, var(--bg) 70%);
  }}

  .title-slide h1 {{
    font-size: 72px;
    font-weight: 900;
    background: linear-gradient(135deg, var(--cyan), var(--pink));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.1;
    margin-bottom: 10px;
  }}

  .title-slide h2 {{
    font-size: 48px;
    font-weight: 800;
    color: var(--white);
    margin-bottom: 30px;
  }}

  .title-slide .subtitle {{
    font-size: 20px;
    color: var(--gray);
    margin-bottom: 60px;
    font-weight: 300;
  }}

  .stats-row {{
    display: flex;
    justify-content: center;
    gap: 30px;
    flex-wrap: wrap;
  }}

  .stat-card {{
    background: var(--bg-card);
    border-radius: 16px;
    padding: 30px 40px;
    text-align: center;
    border: 1px solid rgba(255,255,255,0.06);
    min-width: 180px;
    transition: transform 0.2s;
  }}

  .stat-card:hover {{ transform: translateY(-4px); }}
  .stat-card .num {{ font-size: 42px; font-weight: 800; color: var(--pink); }}
  .stat-card .label {{ font-size: 13px; color: var(--gray); margin-top: 6px; text-transform: uppercase; letter-spacing: 1px; }}

  /* SECTION HEADERS */
  .section-title {{
    font-size: 40px;
    font-weight: 800;
    margin-bottom: 8px;
  }}
  .section-title.pink {{ color: var(--pink); }}
  .section-title.cyan {{ color: var(--cyan); }}

  .section-subtitle {{
    font-size: 16px;
    color: var(--gray);
    margin-bottom: 40px;
    font-weight: 300;
  }}

  /* CATEGORY CARDS */
  .categories-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }}

  .cat-card {{
    background: var(--bg-card);
    border-radius: 16px;
    padding: 28px 30px;
    display: flex;
    align-items: flex-start;
    gap: 20px;
    border: 1px solid rgba(255,255,255,0.04);
    transition: background 0.2s;
  }}

  .cat-card:hover {{ background: var(--bg-card-hover); }}

  .cat-num {{
    width: 50px; height: 50px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 20px; color: white;
    flex-shrink: 0;
  }}

  .cat-info h3 {{ font-size: 20px; font-weight: 700; margin-bottom: 6px; }}
  .cat-info .cat-views {{ font-size: 13px; font-weight: 600; margin-bottom: 8px; }}
  .cat-info p {{ font-size: 13px; color: var(--light-gray); line-height: 1.5; }}

  /* VIDEO CARDS */
  .videos-grid {{
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
  }}

  .video-card {{
    background: var(--bg-card);
    border-radius: 14px;
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,255,255,0.04);
    transition: transform 0.2s, box-shadow 0.2s;
  }}

  .video-card:hover {{
    transform: translateY(-6px);
    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
  }}

  .rank {{
    position: absolute; top: 10px; left: 10px;
    background: var(--pink); color: white;
    font-weight: 800; font-size: 14px;
    padding: 4px 10px; border-radius: 8px;
    z-index: 2;
  }}

  .thumb-link {{ display: block; }}
  .thumb {{ width: 100%; aspect-ratio: 9/16; object-fit: cover; display: block; }}
  .thumb-placeholder {{
    width: 100%; aspect-ratio: 9/16;
    background: #222;
    display: flex; align-items: center; justify-content: center;
    color: var(--gray); font-size: 12px;
  }}

  .card-body {{ padding: 14px; }}
  .author {{ font-weight: 700; color: var(--cyan); font-size: 14px; margin-bottom: 6px; }}
  .metrics {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }}
  .metrics span {{ font-size: 11px; font-weight: 600; }}
  .views {{ color: var(--pink); }}
  .likes {{ color: var(--cyan); }}
  .comments {{ color: var(--gray); }}
  .caption {{ font-size: 11px; color: var(--gray); line-height: 1.4; }}

  /* HOOKS */
  .hooks-list {{ display: flex; flex-direction: column; gap: 12px; }}

  .hook-row {{
    display: flex; align-items: center; gap: 16px;
    padding: 16px 24px;
    background: var(--bg-card);
    border-radius: 12px;
    border-left: 4px solid;
    transition: background 0.2s;
  }}
  .hook-row:hover {{ background: var(--bg-card-hover); }}

  .hook-text {{ flex: 1; font-size: 17px; font-weight: 400; }}

  .hook-badge {{
    padding: 6px 18px; border-radius: 20px;
    font-weight: 800; font-size: 16px; color: white;
    white-space: nowrap;
  }}

  .hook-type {{ font-size: 13px; color: var(--gray); white-space: nowrap; min-width: 140px; text-align: right; }}

  /* HASHTAG BARS */
  .hashtag-bars {{ display: flex; flex-direction: column; gap: 24px; }}

  .hashtag-row {{ display: flex; align-items: center; gap: 20px; }}
  .hashtag-name {{ font-size: 24px; font-weight: 800; width: 280px; }}

  .bar-container {{
    flex: 1; height: 36px;
    background: #1a1a1a; border-radius: 18px;
    overflow: hidden; position: relative;
  }}

  .bar-fill {{
    height: 100%; border-radius: 18px;
    display: flex; align-items: center; justify-content: flex-end;
    padding-right: 14px;
    font-size: 12px; font-weight: 700; color: white;
    transition: width 0.8s ease;
  }}

  .hashtag-note {{ font-size: 12px; color: var(--gray); margin-top: 4px; margin-left: 300px; }}

  /* TOOLS GRID */
  .tools-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }}

  .tool-card {{
    background: var(--bg-card);
    border-radius: 12px;
    padding: 18px 24px;
    display: flex; align-items: center; justify-content: space-between;
    border: 1px solid rgba(255,255,255,0.04);
    transition: background 0.2s;
  }}
  .tool-card:hover {{ background: var(--bg-card-hover); }}

  .tool-name {{ font-size: 18px; font-weight: 700; color: var(--pink); }}
  .tool-use {{ font-size: 12px; color: var(--light-gray); margin-top: 3px; }}
  .tool-note {{ font-size: 11px; color: var(--cyan); text-align: right; max-width: 200px; }}

  /* TAKEAWAYS */
  .takeaways-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }}

  .takeaway-card {{
    background: var(--bg-card);
    border-radius: 16px;
    padding: 28px 30px;
    border-left: 5px solid;
    transition: background 0.2s;
  }}
  .takeaway-card:hover {{ background: var(--bg-card-hover); }}

  .takeaway-num {{ font-size: 28px; font-weight: 800; margin-bottom: 6px; }}
  .takeaway-title {{ font-size: 20px; font-weight: 700; margin-bottom: 10px; color: var(--white); }}
  .takeaway-desc {{ font-size: 13px; color: var(--light-gray); line-height: 1.6; }}

  /* PRINT / PDF */
  @media print {{
    .slide {{ page-break-after: always; min-height: 100vh; }}
  }}
</style>
</head>
<body>

<!-- SLIDE 1: TITLE -->
<div class="slide title-slide">
  <h1>TRENDING TIKTOK TOPICS</h1>
  <h2>IN THE AI NICHE</h2>
  <p class="subtitle">March 2026 &nbsp;|&nbsp; Live data scraped via Apify &nbsp;|&nbsp; 47 videos analyzed</p>
  <div class="stats-row">
    <div class="stat-card"><div class="num">47</div><div class="label">Videos Scraped</div></div>
    <div class="stat-card"><div class="num">15</div><div class="label">Transcripts</div></div>
    <div class="stat-card"><div class="num">62.8M</div><div class="label">Top Views</div></div>
    <div class="stat-card"><div class="num">4.5%</div><div class="label">Avg Engagement</div></div>
  </div>
  <div class="slide-number">01 / 09</div>
</div>

<!-- SLIDE 2: CATEGORIES -->
<div class="slide">
  <div class="section-title cyan">6 TRENDING CONTENT CATEGORIES</div>
  <div class="section-subtitle">What's working in AI TikTok right now, ranked by peak virality</div>
  <div class="categories-grid">
    <div class="cat-card">
      <div class="cat-num" style="background:var(--pink)">01</div>
      <div class="cat-info">
        <h3>AI Entertainment</h3>
        <div class="cat-views" style="color:var(--pink)">62.8M top views</div>
        <p>Funny AI-generated videos, dancing characters, face swaps, talking food objects. Pure entertainment that showcases AI capabilities.</p>
      </div>
    </div>
    <div class="cat-card">
      <div class="cat-num" style="background:var(--cyan)">02</div>
      <div class="cat-info">
        <h3>AI Tools Listicles</h3>
        <div class="cat-views" style="color:var(--cyan)">1.7M top views</div>
        <p>"Use this for X" rapid-fire roundups. Fast-paced, each tool gets 2-3 seconds. Always ends with "follow for more."</p>
      </div>
    </div>
    <div class="cat-card">
      <div class="cat-num" style="background:var(--purple)">03</div>
      <div class="cat-info">
        <h3>AI Industry Drama</h3>
        <div class="cat-views" style="color:var(--purple)">437K top views</div>
        <p>Anthropic vs OpenAI, Pentagon controversy, CEO leaks. Strong opinion-driven content that creates tribalism.</p>
      </div>
    </div>
    <div class="cat-card">
      <div class="cat-num" style="background:var(--green)">04</div>
      <div class="cat-info">
        <h3>AI Tutorials</h3>
        <div class="cat-views" style="color:var(--green)">286K top views</div>
        <p>Step-by-step creation guides. Screen recordings with voiceover showing how to use Gemini, Kling, Nano Banana Pro.</p>
      </div>
    </div>
    <div class="cat-card">
      <div class="cat-num" style="background:var(--yellow)">05</div>
      <div class="cat-info">
        <h3>AI Tips & Secrets</h3>
        <div class="cat-views" style="color:var(--yellow)">185K top views</div>
        <p>"Things you didn't know about Claude/ChatGPT." Makes viewers feel they're getting insider knowledge.</p>
      </div>
    </div>
    <div class="cat-card">
      <div class="cat-num" style="background:var(--orange)">06</div>
      <div class="cat-info">
        <h3>AI Business & Money</h3>
        <div class="cat-views" style="color:var(--orange)">401K top views</div>
        <p>AI agents with crypto wallets, "$10K of work for $32/month." Concrete numbers create curiosity gaps.</p>
      </div>
    </div>
  </div>
  <div class="slide-number">02 / 09</div>
</div>

<!-- SLIDE 3: TOP 5 VIDEOS -->
<div class="slide">
  <div class="section-title pink">TOP 5 VIRAL VIDEOS</div>
  <div class="section-subtitle">Ranked by total views</div>
  <div class="videos-grid">{cards_top5}</div>
  <div class="slide-number">03 / 09</div>
</div>

<!-- SLIDE 4: VIDEOS 6-10 -->
<div class="slide">
  <div class="section-title pink">VIRAL VIDEOS #6 - 10</div>
  <div class="section-subtitle">Ranked by total views</div>
  <div class="videos-grid">{cards_6_10}</div>
  <div class="slide-number">04 / 09</div>
</div>

<!-- SLIDE 5: VIDEOS 11-15 -->
<div class="slide">
  <div class="section-title pink">VIRAL VIDEOS #11 - 15</div>
  <div class="section-subtitle">Ranked by total views</div>
  <div class="videos-grid">{cards_11_15}</div>
  <div class="slide-number">05 / 09</div>
</div>

<!-- SLIDE 6: HOOKS -->
<div class="slide">
  <div class="section-title pink">TOP PERFORMING HOOKS</div>
  <div class="section-subtitle">Extracted from video transcripts - what makes viewers stay</div>
  <div class="hooks-list">
    <div class="hook-row" style="border-color:var(--pink)">
      <div class="hook-text">"I finally stopped gatekeeping"</div>
      <div class="hook-badge" style="background:var(--pink)">62.8M</div>
      <div class="hook-type">Curiosity / FOMO</div>
    </div>
    <div class="hook-row" style="border-color:var(--cyan)">
      <div class="hook-text">"Do you wanna [X]? Use this." (repeated pattern)</div>
      <div class="hook-badge" style="background:var(--cyan)">1.7M</div>
      <div class="hook-type">Rapid-fire value</div>
    </div>
    <div class="hook-row" style="border-color:var(--purple)">
      <div class="hook-text">"Here's why everyone's canceling ChatGPT"</div>
      <div class="hook-badge" style="background:var(--purple)">437K</div>
      <div class="hook-type">Controversy</div>
    </div>
    <div class="hook-row" style="border-color:var(--green)">
      <div class="hook-text">"13,000 AI Agents opened crypto wallets in a single day"</div>
      <div class="hook-badge" style="background:var(--green)">401K</div>
      <div class="hook-type">Shocking stat</div>
    </div>
    <div class="hook-row" style="border-color:var(--yellow)">
      <div class="hook-text">"Things you didn't know you can do with Claude"</div>
      <div class="hook-badge" style="background:var(--yellow);color:#000">185K</div>
      <div class="hook-type">Exclusivity</div>
    </div>
    <div class="hook-row" style="border-color:var(--orange)">
      <div class="hook-text">"2.5M people have uninstalled ChatGPT, myself included"</div>
      <div class="hook-badge" style="background:var(--orange)">170K</div>
      <div class="hook-type">Social proof + controversy</div>
    </div>
    <div class="hook-row" style="border-color:var(--cyan)">
      <div class="hook-text">"ChatGPT is fighting back today"</div>
      <div class="hook-badge" style="background:var(--cyan)">143K</div>
      <div class="hook-type">Breaking news urgency</div>
    </div>
    <div class="hook-row" style="border-color:var(--green)">
      <div class="hook-text">"I love using AI as a hook... let me show you how"</div>
      <div class="hook-badge" style="background:var(--green)">117K</div>
      <div class="hook-type">Tutorial promise</div>
    </div>
  </div>
  <div class="slide-number">06 / 09</div>
</div>

<!-- SLIDE 7: HASHTAGS -->
<div class="slide">
  <div class="section-title cyan">HASHTAG PERFORMANCE</div>
  <div class="section-subtitle">Videos scraped per hashtag and strategic notes</div>
  <div class="hashtag-bars">
    <div>
      <div class="hashtag-row">
        <div class="hashtag-name" style="color:var(--pink)">#ai</div>
        <div class="bar-container"><div class="bar-fill" style="width:100%;background:var(--pink)">10 videos</div></div>
      </div>
      <div class="hashtag-note">Broadest reach, highest competition. Use as primary tag.</div>
    </div>
    <div>
      <div class="hashtag-row">
        <div class="hashtag-name" style="color:var(--cyan)">#chatgpt</div>
        <div class="bar-container"><div class="bar-fill" style="width:90%;background:var(--cyan)">10 videos</div></div>
      </div>
      <div class="hashtag-note">Product-specific, strong search intent. Great for tool content.</div>
    </div>
    <div>
      <div class="hashtag-row">
        <div class="hashtag-name" style="color:var(--green)">#aitutorial</div>
        <div class="bar-container"><div class="bar-fill" style="width:75%;background:var(--green)">10 videos</div></div>
      </div>
      <div class="hashtag-note">Educational audience, high save rate. Best for how-to content.</div>
    </div>
    <div>
      <div class="hashtag-row">
        <div class="hashtag-name" style="color:var(--purple)">#artificialintelligence</div>
        <div class="bar-container"><div class="bar-fill" style="width:70%;background:var(--purple)">9 videos</div></div>
      </div>
      <div class="hashtag-note">Professional audience skew. Good for thought leadership.</div>
    </div>
    <div>
      <div class="hashtag-row">
        <div class="hashtag-name" style="color:var(--yellow)">#aitools</div>
        <div class="bar-container"><div class="bar-fill" style="width:85%;background:var(--yellow)">8 videos</div></div>
      </div>
      <div class="hashtag-note">Purchase intent, listicle magnet. Best for recommendations.</div>
    </div>
  </div>
  <div class="slide-number">07 / 09</div>
</div>

<!-- SLIDE 8: TOOLS -->
<div class="slide">
  <div class="section-title cyan">MOST MENTIONED AI TOOLS</div>
  <div class="section-subtitle">Tools creators are recommending in viral AI TikToks</div>
  <div class="tools-grid">
    <div class="tool-card">
      <div><div class="tool-name">ChatGPT</div><div class="tool-use">Save time, general AI assistant</div></div>
      <div class="tool-note">Most mentioned overall</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Claude</div><div class="tool-use">Email writing, code, research</div></div>
      <div class="tool-note">Trending - Pentagon controversy boost</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Nano Banana Pro</div><div class="tool-use">Ultra-realistic AI image generation</div></div>
      <div class="tool-note">Rising fast in tutorials</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Gemini AI</div><div class="tool-use">Video analysis, image generation</div></div>
      <div class="tool-note">Google's multimodal play</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Higgsfield</div><div class="tool-use">AI video creation + motion control</div></div>
      <div class="tool-note">New favorite for Reels</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">RunwayML</div><div class="tool-use">AI video editing & generation</div></div>
      <div class="tool-note">Established creative tool</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Bolt.new</div><div class="tool-use">AI website builder</div></div>
      <div class="tool-note">Dev community favorite</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">NotebookLM</div><div class="tool-use">Learn new skills with AI</div></div>
      <div class="tool-note">Google's sleeper hit</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Replit</div><div class="tool-use">Build apps with AI coding</div></div>
      <div class="tool-note">No-code revolution</div>
    </div>
    <div class="tool-card">
      <div><div class="tool-name">Perplexity</div><div class="tool-use">AI-powered research</div></div>
      <div class="tool-note">Replacing Google Search</div>
    </div>
  </div>
  <div class="slide-number">08 / 09</div>
</div>

<!-- SLIDE 9: TAKEAWAYS -->
<div class="slide">
  <div class="section-title pink">ACTIONABLE TAKEAWAYS</div>
  <div class="section-subtitle">What to do with this data</div>
  <div class="takeaways-grid">
    <div class="takeaway-card" style="border-color:var(--pink)">
      <div class="takeaway-num" style="color:var(--pink)">01</div>
      <div class="takeaway-title">Entertainment-first wins</div>
      <div class="takeaway-desc">The highest-performing AI content is funny and surprising, not educational. Lead with entertainment, embed the AI angle subtly.</div>
    </div>
    <div class="takeaway-card" style="border-color:var(--cyan)">
      <div class="takeaway-num" style="color:var(--cyan)">02</div>
      <div class="takeaway-title">Listicle format is reliable</div>
      <div class="takeaway-desc">"Use this for X" with 6-8 tools consistently gets 100K+ views. Fast pace, 2-3 seconds per tool. End with a follow CTA.</div>
    </div>
    <div class="takeaway-card" style="border-color:var(--purple)">
      <div class="takeaway-num" style="color:var(--purple)">03</div>
      <div class="takeaway-title">AI drama is a goldmine</div>
      <div class="takeaway-desc">Anthropic vs OpenAI controversy is driving massive engagement right now. Take a stance, create tribalism, ride the news cycle.</div>
    </div>
    <div class="takeaway-card" style="border-color:var(--green)">
      <div class="takeaway-num" style="color:var(--green)">04</div>
      <div class="takeaway-title">Use concrete numbers</div>
      <div class="takeaway-desc">$10,000... 13,000 agents... 2.5M uninstalls. Specific numbers in hooks create irresistible curiosity gaps that stop the scroll.</div>
    </div>
    <div class="takeaway-card" style="border-color:var(--yellow)">
      <div class="takeaway-num" style="color:var(--yellow)">05</div>
      <div class="takeaway-title">Claude is trending hard</div>
      <div class="takeaway-desc">Multiple viral videos about Claude features + Anthropic controversy boosting awareness. Great time to make Claude-focused content.</div>
    </div>
    <div class="takeaway-card" style="border-color:var(--orange)">
      <div class="takeaway-num" style="color:var(--orange)">06</div>
      <div class="takeaway-title">Tutorials need visual hooks</div>
      <div class="takeaway-desc">Before/after or transformation reveals outperform dry screen recordings. Show the amazing result first, then teach how.</div>
    </div>
  </div>
  <div class="slide-number">09 / 09</div>
</div>

</body>
</html>'''

    with open(OUTPUT_FILE, "w") as f:
        f.write(html)

    print(f"Presentation saved to {OUTPUT_FILE}")
    size_mb = os.path.getsize(OUTPUT_FILE) / 1_048_576
    print(f"File size: {size_mb:.1f}MB")


if __name__ == "__main__":
    main()
