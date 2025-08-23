<template>
  <div class="qr-generator">
    <div v-if="qrCodeData" class="qr-preview" @click="toggleButtons">
      <canvas ref="qrCanvas"></canvas>

      <!-- Action buttons -->
      <div v-if="showButtons" class="action-buttons">
        <button class="action-btn print-btn" @click.stop="printQR">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6,9 6,2 18,2 18,9"></polyline>
            <path d="M6,18H4a2,2 0 01-2-2V11a2,2 0 012-2H20a2,2 0 012,2v5a2,2 0 01-2,2H18"></path>
            <polyline points="6,14 18,14 18,20 6,20 6,14"></polyline>
          </svg>
          Print
        </button>
        <button class="action-btn fullscreen-btn" @click.stop="toggleFullscreen">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"
            ></path>
          </svg>
          Fullscreen
        </button>
      </div>
    </div>

    <!-- Fullscreen overlay -->
    <div v-if="isFullscreen" class="fullscreen-overlay" @click.self="exitFullscreen">
      <div class="fullscreen-content">
        <button class="close-btn" @click="exitFullscreen">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div class="fullscreen-qr">
          <canvas ref="fullscreenCanvas"></canvas>
        </div>

        <div class="display-text">
          <p>{{ displayText }}</p>
        </div>

        <button class="action-btn print-btn fullscreen-print" @click="printFullscreen">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6,9 6,2 18,2 18,9"></polyline>
            <path d="M6,18H4a2,2 0 01-2-2V11a2,2 0 012-2H20a2,2 0 012,2v5a2,2 0 01-2,2H18"></path>
            <polyline points="6,14 18,14 18,20 6,20 6,14"></polyline>
          </svg>
          Print
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import QRCode from 'qrcode'

const { data } = defineProps<{
  data: unknown
}>()

// Reactive state
const inputText = computed(() => {
  if (typeof data === 'string') {
    return data
  } else {
    return JSON.stringify(data)
  }
})
const size = ref(200)
const qrCodeData = ref<string | null>(null)
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const fullscreenCanvas = ref<HTMLCanvasElement | null>(null)
const showButtons = ref(false)
const isFullscreen = ref(false)
const displayText = ref(
  'Scan this QR code to start a conversation with our AI assistant on Taskyon. This is a secure link to our official chat platform - simply scan and begin chatting!',
)

// Generate QR code
const generateQR = async () => {
  if (!inputText.value.trim()) return

  try {
    qrCodeData.value = await QRCode.toDataURL(inputText.value, {
      width: size.value,
      errorCorrectionLevel: 'H',
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })

    void nextTick(() => {
      if (!qrCanvas.value || !qrCodeData.value) return
      drawQRWithLogo(qrCanvas.value, qrCodeData.value, size.value)
    })
  } catch (err) {
    console.error('QR generation failed:', err)
    qrCodeData.value = null
  }
}

// Helper function to draw QR with logo overlay
const drawQRWithLogo = (canvas: HTMLCanvasElement, qrDataUrl: string, qrSize: number) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const qrImg = new Image()
  qrImg.onload = () => {
    canvas.width = qrImg.width
    canvas.height = qrImg.height
    ctx.drawImage(qrImg, 0, 0)

    // Create logo overlay
    const logoSize = Math.floor(qrSize * 0.18) // Slightly smaller logo
    const logoX = (canvas.width - logoSize) / 2
    const logoY = (canvas.height - logoSize) / 2

    // Draw white background circle for logo (reduced padding)
    const padding = 4 // Reduced from 8 to 4
    const bgRadius = (logoSize + padding * 2) / 2
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(canvas.width / 2, canvas.height / 2, bgRadius, 0, 2 * Math.PI)
    ctx.fill()

    // Draw subtle border around logo background
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.stroke()

    // Load and draw the SVG logo
    loadSVGLogo((logoDataUrl) => {
      if (logoDataUrl) {
        const logoImg = new Image()
        logoImg.onload = () => {
          // Save the canvas state
          ctx.save()

          // Create circular clipping path for the logo
          ctx.beginPath()
          ctx.arc(canvas.width / 2, canvas.height / 2, logoSize / 2, 0, 2 * Math.PI)
          ctx.clip()

          // Draw logo maintaining aspect ratio
          ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize)

          // Restore canvas state
          ctx.restore()
        }
        logoImg.src = logoDataUrl
      } else {
        // Fallback: draw a simple "T" for Taskyon
        drawFallbackLogo(ctx, logoX, logoY, logoSize)
      }
    })
  }
  qrImg.src = qrDataUrl
}

// Function to load SVG logo and convert to data URL
const loadSVGLogo = (callback: (dataUrl: string | null) => void) => {
  // Try to load the SVG logo
  fetch('/taskyon_mono_opt.svg')
    .then((response) => {
      if (!response.ok) throw new Error('SVG not found')
      return response.text()
    })
    .then((svgText) => {
      // Create a data URL from the SVG
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(svgBlob)

      const img = new Image()
      img.onload = () => {
        const tempCanvas = document.createElement('canvas')
        const tempCtx = tempCanvas.getContext('2d')
        if (tempCtx) {
          // Set canvas size to maintain aspect ratio
          const aspectRatio = img.width / img.height
          const canvasSize = 200

          if (aspectRatio > 1) {
            // Wider than tall
            tempCanvas.width = canvasSize
            tempCanvas.height = canvasSize / aspectRatio
          } else {
            // Taller than wide
            tempCanvas.width = canvasSize * aspectRatio
            tempCanvas.height = canvasSize
          }

          // Fill with transparent background
          tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height)

          // Draw the SVG maintaining its aspect ratio
          tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height)
          callback(tempCanvas.toDataURL('image/png'))
        } else {
          callback(null)
        }
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        callback(null)
      }
      img.src = url
    })
    .catch(() => {
      // If SVG loading fails, use fallback
      callback(null)
    })
}

// Fallback logo drawing function
const drawFallbackLogo = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  ctx.fillStyle = '#4f46e5'
  ctx.font = `bold ${size * 0.6}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('T', x + size / 2, y + size / 2)
}

// Toggle action buttons visibility
const toggleButtons = () => {
  showButtons.value = !showButtons.value
}

// Print QR code
const printQR = () => {
  if (!qrCanvas.value) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  // Get the canvas with logo as data URL
  const canvasDataUrl = qrCanvas.value.toDataURL('image/png')

  printWindow.document.write(`
    <html>
      <head>
        <title>Taskyon QR Code</title>
        <style>
          body {
            margin: 0;
            padding: 40px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            line-height: 1.6;
            background: white;
            color: #333;
          }
          .print-container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .qr-section {
            margin-bottom: 30px;
          }
          .qr-section img {
            max-width: 300px;
            height: auto;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          }
          .text-section {
            margin-top: 30px;
            padding: 20px;
            background: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          .text-content {
            font-size: 16px;
            color: #475569;
            margin: 0;
            max-width: 450px;
            margin: 0 auto;
          }
          @media print {
            body {
              padding: 20px;
            }
            .print-container {
              page-break-inside: avoid;
            }
            .text-section {
              box-shadow: none;
              border: 1px solid #ccc;
            }
          }
        </style>
      </head>
      <body onload="window.print(); setTimeout(function(){ window.close(); }, 100);">
        <div class="print-container">
          <div class="qr-section">
            <img src="${canvasDataUrl}" alt="Taskyon QR Code" />
          </div>
          <div class="text-section">
            <p class="text-content">${displayText.value}</p>
          </div>
        </div>
      </body>
    </html>
  `)
  printWindow.document.close()
}

// Toggle fullscreen mode
const toggleFullscreen = async () => {
  isFullscreen.value = true
  showButtons.value = false

  await nextTick()

  if (fullscreenCanvas.value && qrCodeData.value) {
    // Generate larger QR for fullscreen
    const fullscreenQR = await QRCode.toDataURL(inputText.value, {
      width: 400,
      errorCorrectionLevel: 'H',
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
    drawQRWithLogo(fullscreenCanvas.value, fullscreenQR, 400)
  }
}

// Exit fullscreen mode
const exitFullscreen = () => {
  isFullscreen.value = false
}

// Print fullscreen with display text
const printFullscreen = () => {
  if (!fullscreenCanvas.value) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) return

  // Get the fullscreen canvas with logo as data URL
  const canvasDataUrl = fullscreenCanvas.value.toDataURL('image/png')

  printWindow.document.write(`
    <html>
      <head>
        <title>Taskyon QR Code</title>
        <style>
          body {
            margin: 0;
            padding: 40px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            line-height: 1.6;
            background: white;
            color: #333;
          }
          .print-container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
          }
          .qr-section {
            margin-bottom: 40px;
          }
          .qr-section img {
            max-width: 350px;
            height: auto;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          }
          .text-section {
            margin-top: 30px;
            padding: 25px;
            background: #f8fafc;
            border-radius: 12px;
            border: 2px solid #e2e8f0;
          }
          .text-content {
            font-size: 18px;
            color: #475569;
            margin: 0;
            max-width: 500px;
            margin: 0 auto;
          }
          @media print {
            body {
              padding: 20px;
            }
            .print-container {
              page-break-inside: avoid;
            }
            .text-section {
              box-shadow: none;
              border: 1px solid #ccc;
            }
          }
        </style>
      </head>
      <body onload="window.print(); setTimeout(function(){ window.close(); }, 100);">
        <div class="print-container">
          <div class="qr-section">
            <img src="${canvasDataUrl}" alt="Taskyon QR Code" />
          </div>
          <div class="text-section">
            <p class="text-content">${displayText.value}</p>
          </div>
        </div>
      </body>
    </html>
  `)
  printWindow.document.close()
}

// Generate initial QR on mount
onMounted(generateQR)
</script>

<style scoped>
.qr-generator {
  position: relative;
}

.qr-preview {
  position: relative;
  display: inline-block;
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease;
}

.qr-preview:hover {
  transform: scale(1.02);
}

.qr-preview canvas {
  display: block;
}

.action-buttons {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 10px;
  background: rgba(0, 0, 0, 0.8);
  padding: 10px;
  border-radius: 8px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: white;
}

.print-btn {
  background: #4f46e5;
}

.print-btn:hover {
  background: #4338ca;
  transform: translateY(-1px);
}

.fullscreen-btn {
  background: #059669;
}

.fullscreen-btn:hover {
  background: #047857;
  transform: translateY(-1px);
}

.clear-btn {
  background: #dc2626;
}

.clear-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

/* Fullscreen styles */
.fullscreen-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
}

.fullscreen-content {
  width: 100%;
  height: 100%;
  padding: 30px;
  max-width: 100vw;
  max-height: 100vh;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 30px;
}

.close-btn {
  position: absolute;
  top: 15px;
  right: 15px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: background 0.2s ease;
  color: #666;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #333;
}

.fullscreen-qr {
  text-align: center;
}

.fullscreen-qr canvas {
  max-width: 90vw;
  max-height: 50vh;
  width: auto;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.display-text {
  max-width: 500px;
  text-align: center;
  margin-top: 20px;
  padding: 20px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.display-text p {
  margin: 0;
  font-size: 18px;
  line-height: 1.6;
  color: #475569;
}

.fullscreen-print {
  margin-top: 20px;
}

@media (max-width: 768px) {
  .fullscreen-content {
    padding: 20px;
    margin: 10px;
  }

  .action-buttons {
    flex-direction: column;
  }

  .fullscreen-actions {
    flex-direction: column;
  }
}
</style>
