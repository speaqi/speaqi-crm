'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getGuideBySlug } from '@/lib/guides-data'

export default function GuideDetailPage({ params }: { params: { slug: string } }) {
  const guide = getGuideBySlug(params.slug)
  const [playingVideo, setPlayingVideo] = useState(false)
  const [playingAudio, setPlayingAudio] = useState(false)

  if (!guide) {
    return (
      <div className="guides-container guides-page">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>😕</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
            Guida non trovata
          </h1>
          <p style={{ color: 'var(--text2)', marginBottom: '24px' }}>
            La guida che cerchi non esiste.
          </p>
          <Link
            href="/guides/napoli"
            style={{
              display: 'inline-block',
              background: 'var(--accent)',
              color: 'white',
              padding: '10px 24px',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Torna alle guide
          </Link>
        </div>
      </div>
    )
  }

  const transcriptLines = guide.transcript
    ? guide.transcript.split('\n').filter((line) => line.trim())
    : []

  return (
    <div className="guides-container guides-page guide-detail">
      <div className="guide-detail-header">
        <Link href="/guides/napoli" className="guide-detail-back">
          ← Torna alle guide
        </Link>

        <div className="guide-detail-kicker">{guide.category}</div>
        <h1 className="guide-detail-title">{guide.title}</h1>
        <p className="guide-detail-subtitle">{guide.description}</p>

        <div className="guide-detail-meta">
          <div className="guide-detail-meta-item">
            <div className="guide-detail-meta-label">Tipo</div>
            <div>
              {guide.type === 'both'
                ? '📹 Videomap + 🎧 Audiomap'
                : guide.type === 'videomap'
                  ? '📹 Videomap'
                  : '🎧 Audiomap'}
            </div>
          </div>
          <div className="guide-detail-meta-item">
            <div className="guide-detail-meta-label">Durata</div>
            <div>{guide.duration} minuti</div>
          </div>
          <div className="guide-detail-meta-item">
            <div className="guide-detail-meta-label">Città</div>
            <div>📍 Napoli</div>
          </div>
        </div>
      </div>

      <div className="guide-detail-content">
        {/* Viewer */}
        <div className="guide-viewer">
          {(guide.type === 'videomap' || guide.type === 'both') && (
            <div className="guide-media">
              <div
                className="guide-media-video"
                onClick={() => setPlayingVideo(!playingVideo)}
                style={{ cursor: 'pointer' }}
              >
                {playingVideo ? '▶️ Playing...' : `${guide.icon} Click to play`}
              </div>
              <div className="guide-media-controls">
                <button
                  className="play-btn"
                  onClick={() => setPlayingVideo(!playingVideo)}
                >
                  {playingVideo ? '⏸' : '▶'}
                </button>
                <div className="progress-bar">
                  <div className="progress-fill"></div>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text2)' }}>
                  {guide.duration}:00
                </span>
              </div>
            </div>
          )}

          {(guide.type === 'audiomap' || guide.type === 'both') && (
            <div className="guide-media">
              <div
                className="guide-media-audio"
                onClick={() => setPlayingAudio(!playingAudio)}
                style={{ cursor: 'pointer' }}
              >
                {playingAudio ? '🎧 Playing audio...' : '🎧 Click to play audio'}
              </div>
              <div className="guide-media-controls">
                <button
                  className="play-btn"
                  onClick={() => setPlayingAudio(!playingAudio)}
                >
                  {playingAudio ? '⏸' : '▶'}
                </button>
                <div className="progress-bar">
                  <div className="progress-fill"></div>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text2)' }}>
                  {guide.duration}:00
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="guide-sidebar">
          {/* Tags */}
          {guide.tags.length > 0 && (
            <div className="guide-section">
              <div className="guide-section-title">Tag</div>
              <div className="guide-section-content">
                <div className="guide-card-tags">
                  {guide.tags.map((tag) => (
                    <span key={tag} className="guide-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Transcript */}
          {transcriptLines.length > 0 && (
            <div className="guide-section">
              <div className="guide-section-title">📝 Transcript</div>
              <div className="guide-transcript">
                {transcriptLines.map((line, i) => (
                  <div key={i} className="transcript-line">
                    {line.includes(' - ') ? (
                      <>
                        <span className="transcript-time">
                          {line.split(' - ')[0]}
                        </span>
                        <span className="transcript-text">
                          {line.split(' - ')[1]}
                        </span>
                      </>
                    ) : (
                      <span className="transcript-text">{line}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resources */}
          <div className="guide-section">
            <div className="guide-section-title">📚 Risorse</div>
            <div className="guide-section-content">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <a
                  href="#"
                  style={{
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Download Transcript →
                </a>
                <a
                  href="#"
                  style={{
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Condividi con il team →
                </a>
                <a
                  href="#"
                  style={{
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Segnala un problema →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
