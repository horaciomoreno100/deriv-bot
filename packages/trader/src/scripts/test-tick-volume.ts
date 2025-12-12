/**
 * Test Tick Volume Proxy
 *
 * Este script prueba si podemos usar el NÚMERO DE TICKS por vela
 * como proxy de volumen, ya que Deriv no proporciona volumen real
 * para forex.
 *
 * La idea es: más ticks = más actividad = más "volumen"
 */

import WebSocket from 'ws';

const APP_ID = process.env.DERIV_APP_ID || '106646';
const SYMBOL = process.env.ASSET || 'frxEURUSD';

interface TickData {
  epoch: number;
  quote: number;
}

/**
 * Simple WebSocket client
 */
class DerivClient {
  private ws: WebSocket;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(appId: string) {
    this.ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);

    this.ws.on('message', (data: any) => {
      const response = JSON.parse(data.toString());

      if (response.req_id && this.pendingRequests.has(response.req_id)) {
        const { resolve, reject } = this.pendingRequests.get(response.req_id)!;
        this.pendingRequests.delete(response.req_id);

        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response);
        }
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', (error) => reject(error));
    });
  }

  async request(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;
      const requestPayload = { ...payload, req_id: reqId };

      this.pendingRequests.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify(requestPayload));

      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('📊 TEST: Tick Count como Volume Proxy');
  console.log('='.repeat(60));
  console.log(`\nSymbol: ${SYMBOL}`);
  console.log(`App ID: ${APP_ID}\n`);

  const client = new DerivClient(APP_ID);
  await client.connect();
  console.log('✅ Connected to Deriv API\n');

  // Test 1: Obtener candles y ver si tienen volumen
  console.log('📥 Test 1: Verificando campo volume en candles...');
  const candlesResponse = await client.request({
    ticks_history: SYMBOL,
    style: 'candles',
    granularity: 60,
    count: 5,
    end: 'latest',
  });

  console.log('\nCandles recibidas:');
  for (const candle of candlesResponse.candles) {
    console.log(`  Epoch: ${candle.epoch}, OHLC: ${candle.open}/${candle.high}/${candle.low}/${candle.close}, Volume: ${candle.volume || 'NO EXISTE'}`);
  }

  // Test 2: Obtener ticks para contar
  console.log('\n📥 Test 2: Obteniendo ticks para una ventana de 5 minutos...');

  const now = Math.floor(Date.now() / 1000);
  const fiveMinutesAgo = now - 300; // 5 minutos atrás

  const ticksResponse = await client.request({
    ticks_history: SYMBOL,
    style: 'ticks',
    start: fiveMinutesAgo,
    end: now,
    count: 5000, // máximo
  });

  if (ticksResponse.history) {
    const prices = ticksResponse.history.prices || [];
    const times = ticksResponse.history.times || [];

    console.log(`\n📊 Resultados para ${SYMBOL} (últimos 5 minutos):`);
    console.log(`   Total ticks recibidos: ${prices.length}`);
    console.log(`   Ticks por minuto promedio: ${(prices.length / 5).toFixed(1)}`);

    // Agrupar ticks por minuto
    const ticksPerMinute: Map<number, number> = new Map();

    for (const time of times) {
      const minuteKey = Math.floor(time / 60) * 60;
      ticksPerMinute.set(minuteKey, (ticksPerMinute.get(minuteKey) || 0) + 1);
    }

    console.log(`\n   Distribución por minuto:`);
    const sorted = Array.from(ticksPerMinute.entries()).sort((a, b) => a[0] - b[0]);
    for (const [minute, count] of sorted) {
      const date = new Date(minute * 1000);
      console.log(`     ${date.toISOString().slice(11, 19)}: ${count} ticks`);
    }

    // Calcular estadísticas
    const counts = Array.from(ticksPerMinute.values());
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const max = Math.max(...counts);
    const min = Math.min(...counts);

    console.log(`\n   Estadísticas de tick count por minuto:`);
    console.log(`     Promedio: ${avg.toFixed(1)} ticks/min`);
    console.log(`     Máximo: ${max} ticks/min`);
    console.log(`     Mínimo: ${min} ticks/min`);
    console.log(`     Rango: ${max - min} ticks`);

    // Conclusión
    console.log('\n' + '='.repeat(60));
    console.log('📝 CONCLUSIÓN:');
    console.log('='.repeat(60));

    if (counts.length > 0 && avg > 10) {
      console.log(`\n✅ ${SYMBOL} tiene suficientes ticks para usar como proxy de volumen!`);
      console.log(`   Promedio de ${avg.toFixed(0)} ticks por minuto`);
      console.log(`   Esto permite detectar picos de actividad vs períodos tranquilos`);
      console.log(`\n💡 SIGUIENTE PASO: Crear script que:`);
      console.log(`   1. Obtenga candles OHLC`);
      console.log(`   2. Para cada candle, obtenga tick count`);
      console.log(`   3. Use tick count como indicador de "volumen"`);
      console.log(`   4. Detecte divergencias volumen/precio`);
    } else {
      console.log(`\n⚠️  ${SYMBOL} tiene pocos ticks (${avg.toFixed(0)}/min)`);
      console.log(`   El tick count puede no ser un buen proxy de volumen`);
    }
  } else {
    console.log('❌ No se recibieron ticks');
    console.log('Response:', JSON.stringify(ticksResponse, null, 2));
  }

  client.close();
}

main().catch(console.error);
