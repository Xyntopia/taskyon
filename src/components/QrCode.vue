<template>
  <div class="qr-generator">
    <div v-if="qrCodeData" class="qr-preview">
      <canvas ref="qrCanvas"></canvas>
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

      const ctx = qrCanvas.value.getContext('2d')
      if (!ctx) return

      const img = new Image()
      img.onload = () => {
        qrCanvas.value!.width = img.width
        qrCanvas.value!.height = img.height
        ctx.drawImage(img, 0, 0)
      }
      img.src = qrCodeData.value
    })
  } catch (err) {
    console.error('QR generation failed:', err)
    qrCodeData.value = null
  }
}

// Generate initial QR on mount
onMounted(generateQR)
</script>
