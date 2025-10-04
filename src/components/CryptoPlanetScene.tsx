import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type TokenSymbol =
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'DOGE'
  | 'ADA'
  | 'XRP'
  | 'BNB'
  | 'MATIC'
  | 'AVAX'
  | 'DOT'
  | 'LINK'
  | 'LTC'
  | 'SHIB'
  | 'TRX'

type TokenQuote = {
  last: number
  changePct: number
}

type TokenMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial> & {
  userData: {
    radius: number
    speed: number
    angle: number
    symbol: TokenSymbol
    labelSprite?: THREE.Sprite
  }
}

const TOKEN_SYMBOLS: TokenSymbol[] = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'BNB', 'MATIC', 'AVAX', 'DOT', 'LINK', 'LTC', 'SHIB', 'TRX']

const SYMBOL_TO_BINANCE: Record<TokenSymbol, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  DOGE: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  XRP: 'XRPUSDT',
  BNB: 'BNBUSDT',
  MATIC: 'MATICUSDT',
  AVAX: 'AVAXUSDT',
  DOT: 'DOTUSDT',
  LINK: 'LINKUSDT',
  LTC: 'LTCUSDT',
  SHIB: 'SHIBUSDT',
  TRX: 'TRXUSDT',
}

const SYMBOL_TO_COINGECKO: Record<TokenSymbol, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  LTC: 'litecoin',
  SHIB: 'shiba-inu',
  TRX: 'tron',
}

const formatUSD = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 2 : 4
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

const fetchFromBinance = async (): Promise<Partial<Record<TokenSymbol, TokenQuote>>> => {
  const symbols = TOKEN_SYMBOLS.map((symbol) => SYMBOL_TO_BINANCE[symbol])
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
  const data = (await res.json()) as Array<{
    symbol?: string
    lastPrice?: string
    priceChangePercent?: string
  }>

  const map: Partial<Record<TokenSymbol, TokenQuote>> = {}
  data.forEach((row) => {
    if (!row.symbol || !row.symbol.endsWith('USDT')) return
    const base = row.symbol.slice(0, -4) as TokenSymbol
    if (!TOKEN_SYMBOLS.includes(base)) return
    map[base] = {
      last: Number.parseFloat(row.lastPrice ?? '0'),
      changePct: Number.parseFloat(row.priceChangePercent ?? '0'),
    }
  })
  return map
}

const fetchFromCoinGecko = async (): Promise<Partial<Record<TokenSymbol, TokenQuote>>> => {
  const ids = TOKEN_SYMBOLS.map((symbol) => SYMBOL_TO_COINGECKO[symbol]).join(',')
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  const data = (await res.json()) as Record<string, { usd: number; usd_24h_change: number }>

  const map: Partial<Record<TokenSymbol, TokenQuote>> = {}
  TOKEN_SYMBOLS.forEach((symbol) => {
    const key = SYMBOL_TO_COINGECKO[symbol]
    if (!data[key]) return
    map[symbol] = {
      last: Number(data[key].usd),
      changePct: Number(data[key].usd_24h_change),
    }
  })
  return map
}

const fetchPrices = async (): Promise<Partial<Record<TokenSymbol, TokenQuote>>> => {
  try {
    return await fetchFromBinance()
  } catch (binanceError) {
    try {
      return await fetchFromCoinGecko()
    } catch (coingeckoError) {
      console.warn('All price sources failed', binanceError, coingeckoError)
      return {}
    }
  }
}

const drawLabelCanvas = (
  ctx: CanvasRenderingContext2D,
  symbol: TokenSymbol,
  priceText: string,
  changePct: number | null,
) => {
  const { canvas } = ctx
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const gradient = ctx.createLinearGradient(0, 0, w, h)
  gradient.addColorStop(0, 'rgba(16, 34, 64, 0.05)')
  gradient.addColorStop(1, 'rgba(0, 163, 255, 0.18)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)'
  ctx.lineWidth = 2
  ctx.strokeRect(4, 4, w - 8, h - 8)
  ctx.shadowColor = 'rgba(0, 229, 255, 0.35)'
  ctx.shadowBlur = 6
  ctx.font = 'bold 28px Arial'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(symbol, w / 2, 42)
  ctx.font = 'bold 22px Arial'
  ctx.fillStyle = '#7cf9d8'
  ctx.fillText(priceText, w / 2, 78)
  if (changePct !== null && changePct !== undefined) {
    ctx.font = '16px Arial'
    ctx.fillStyle = changePct >= 0 ? '#4df0ff' : '#ff7b7b'
    const prefix = changePct >= 0 ? '+' : ''
    ctx.fillText(`${prefix}${changePct.toFixed(2)}% 24h`, w / 2, 102)
  }
}

const createTokenLabelSprite = (symbol: TokenSymbol) => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  drawLabelCanvas(ctx, symbol, '—', null)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(8, 4, 1)
  ;(sprite.userData as { ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture; symbol: TokenSymbol }) = {
    ctx,
    texture,
    symbol,
  }
  return sprite
}

const updateTokenLabel = (sprite: THREE.Sprite, price: number, changePct: number) => {
  const user = sprite.userData as {
    ctx: CanvasRenderingContext2D
    texture: THREE.CanvasTexture
    symbol: TokenSymbol
  }
  drawLabelCanvas(user.ctx, user.symbol, formatUSD(price), changePct)
  user.texture.needsUpdate = true
}

const earthRotationSpeed = 0.001
const tokenOrbitSpeed = 0.0005

export const CryptoPlanetScene = () => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)

  const animationRef = useRef<number | null>(null)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()

    const aspect = container.clientWidth / (container.clientHeight || 1)
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000)
    camera.position.set(0, 20, 50)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.enablePan = false
    controls.minDistance = 9
    controls.maxDistance = 120

    const ambientLight = new THREE.AmbientLight(0x333333)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    const pointLight = new THREE.PointLight(0x00e5ff, 0.65, 140)
    pointLight.position.set(10, 10, 10)
    scene.add(pointLight)

    const loader = new THREE.TextureLoader()
    const backgroundTexture = loader.load('https://raw.githubusercontent.com/pmndrs/drei-assets/master/textures/galaxy1.jpg')
    backgroundTexture.colorSpace = THREE.SRGBColorSpace
    scene.background = backgroundTexture

    const earthGeometry = new THREE.SphereGeometry(10, 64, 64)
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: loader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg'),
      bumpMap: loader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg'),
      bumpScale: 0.05,
      specularMap: loader.load('https://threejs.org/examples/textures/planets/earth_specular_2048.jpg'),
      specular: new THREE.Color(0x333333),
      shininess: 5,
    })
    const earth = new THREE.Mesh(earthGeometry, earthMaterial)
    earth.castShadow = true
    earth.receiveShadow = true
    scene.add(earth)

    const cloudGeometry = new THREE.SphereGeometry(10.2, 64, 64)
    const cloudMaterial = new THREE.MeshPhongMaterial({
      map: loader.load('https://threejs.org/examples/textures/planets/earth_clouds_1024.png'),
      transparent: true,
      opacity: 0.4,
    })
    const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial)
    earth.add(clouds)

    const atmosphereGeometry = new THREE.SphereGeometry(10.5, 64, 64)
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(0x00aaff) },
        viewVector: { value: camera.position.clone() },
      },
      vertexShader:
        'uniform vec3 viewVector; varying float intensity; void main(){ vec3 vNormal = normalize(normalMatrix * normal); vec3 vNormel = normalize(normalMatrix * viewVector); intensity = pow(0.6 - dot(vNormal, vNormel), 2.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 glowColor; varying float intensity; void main(){ vec3 glow = glowColor * intensity; gl_FragColor = vec4(glow, 1.0); }',
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
    })
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial)
    earth.add(atmosphere)

    const tokenMeshes: TokenMesh[] = []
    const ringMeshes: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = []

    const tokenData: Array<{
      name: string
      symbol: TokenSymbol
      color: number
      radius: number
      speed: number
      size: number
    }> = [
      { name: 'Bitcoin', symbol: 'BTC', color: 0xf7931a, radius: 20, speed: 0.26, size: 1.6 },
      { name: 'Ethereum', symbol: 'ETH', color: 0x627eea, radius: 26, speed: 0.32, size: 1.35 },
      { name: 'BNB', symbol: 'BNB', color: 0xf0b90b, radius: 32, speed: 0.38, size: 1.2 },
      { name: 'Solana', symbol: 'SOL', color: 0x00ffbd, radius: 38, speed: 0.44, size: 1.1 },
      { name: 'Dogecoin', symbol: 'DOGE', color: 0xc2a633, radius: 44, speed: 0.5, size: 1 },
      { name: 'Cardano', symbol: 'ADA', color: 0x2a64f6, radius: 50, speed: 0.56, size: 1 },
      { name: 'XRP', symbol: 'XRP', color: 0x00aae4, radius: 56, speed: 0.62, size: 1 },
      { name: 'Polygon', symbol: 'MATIC', color: 0x8247e5, radius: 62, speed: 0.68, size: 0.95 },
      { name: 'Avalanche', symbol: 'AVAX', color: 0xe84142, radius: 68, speed: 0.74, size: 0.95 },
      { name: 'Polkadot', symbol: 'DOT', color: 0xe6007a, radius: 74, speed: 0.8, size: 0.9 },
      { name: 'Chainlink', symbol: 'LINK', color: 0x2a5ada, radius: 80, speed: 0.86, size: 0.9 },
      { name: 'Litecoin', symbol: 'LTC', color: 0xb8b8b8, radius: 86, speed: 0.92, size: 0.85 },
      { name: 'Shiba Inu', symbol: 'SHIB', color: 0xf0513a, radius: 92, speed: 0.98, size: 0.85 },
      { name: 'Tron', symbol: 'TRX', color: 0xff060a, radius: 98, speed: 1.04, size: 0.85 },
    ]

    tokenData.forEach((definition) => {
      const ringGeometry = new THREE.TorusGeometry(definition.radius, 0.05, 16, 100)
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x4b5caa, transparent: true, opacity: 0.12 })
      const ring = new THREE.Mesh(ringGeometry, ringMaterial)
      ring.rotation.x = Math.PI / 2
      scene.add(ring)
      ringMeshes.push(ring)

      const tokenGeometry = new THREE.SphereGeometry(definition.size, 32, 32)
      const tokenMaterial = new THREE.MeshPhongMaterial({
        color: definition.color,
        emissive: new THREE.Color(definition.color),
        emissiveIntensity: 0.28,
        shininess: 100,
      })
      const token = new THREE.Mesh(tokenGeometry, tokenMaterial) as TokenMesh
      token.castShadow = true
      token.userData = {
        radius: definition.radius,
        speed: definition.speed,
        angle: Math.random() * Math.PI * 2,
        symbol: definition.symbol,
      }
      const data = token.userData as TokenMesh['userData']
      token.position.x = Math.cos(data.angle) * data.radius
      token.position.z = Math.sin(data.angle) * data.radius
      scene.add(token)
      tokenMeshes.push(token)

      const glowGeometry = new THREE.SphereGeometry(definition.size * 1.3, 32, 32)
      const glowMaterial = new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(definition.color) } },
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 glowColor; void main(){ gl_FragColor = vec4(glowColor, 0.3); }',
        transparent: true,
        side: THREE.BackSide,
      })
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      token.add(glow)

      const label = createTokenLabelSprite(definition.symbol)
      label.position.set(0, 3, 0)
      token.add(label)
      token.userData.labelSprite = label
    })

    const starGeometry = new THREE.BufferGeometry()
    const starCount = 10000
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount * 3; i += 1) {
      starPositions[i] = (Math.random() - 0.5) * 2000
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: true }),
    )
    scene.add(stars)

    const updateTokenPositions = () => {
      tokenMeshes.forEach((mesh) => {
        const data = mesh.userData as TokenMesh['userData']
        data.angle += tokenOrbitSpeed * data.speed
        mesh.position.x = Math.cos(data.angle) * data.radius
        mesh.position.z = Math.sin(data.angle) * data.radius
      })
    }

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      earth.rotation.y += earthRotationSpeed
      clouds.rotation.y += earthRotationSpeed * 1.2
      ;(atmosphereMaterial.uniforms.viewVector.value as THREE.Vector3).copy(camera.position)
      updateTokenPositions()
      controls.update()
      renderer.render(scene, camera)
    }

    animate()
    setLoading(false)

    const refreshPrices = async () => {
      const priceMap = await fetchPrices()
      tokenMeshes.forEach((mesh) => {
        const data = mesh.userData as TokenMesh['userData']
        const { symbol, labelSprite } = data
        if (!labelSprite) return
        const quote = priceMap[symbol]
        if (!quote) return
        updateTokenLabel(labelSprite, quote.last, quote.changePct)
      })
    }

    void refreshPrices()
    intervalRef.current = window.setInterval(() => {
      void refreshPrices()
    }, 15000)

    const handleResize = () => {
      const width = container.clientWidth || window.innerWidth
      const height = container.clientHeight || Math.max(320, Math.round(width * 0.6))
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    handleResize()
    const observer = new ResizeObserver(handleResize)
    observer.observe(container)

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      starGeometry.dispose()
      ringMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
        scene.remove(mesh)
      })
      scene.remove(stars)
      tokenMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
        mesh.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if ('material' in child) {
              const childMaterial = child.material as THREE.Material | THREE.Material[]
              if (Array.isArray(childMaterial)) {
                childMaterial.forEach((m) => m.dispose())
              } else {
                childMaterial.dispose()
              }
            }
          } else if (child instanceof THREE.Sprite) {
            child.material.dispose()
            const { texture } = child.userData as { texture: THREE.CanvasTexture }
            texture.dispose()
          }
        })
      })
      earthGeometry.dispose()
      earthMaterial.dispose()
      cloudGeometry.dispose()
      cloudMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      backgroundTexture.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#10122b] via-[#060714] to-[#03040b]">
      <div ref={containerRef} className="h-[360px] w-full sm:h-[420px] lg:h-[480px]" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-semibold text-cyan-300">
          Loading 3D planet &amp; live prices…
        </div>
      )}
    </div>
  )
}

export default CryptoPlanetScene
