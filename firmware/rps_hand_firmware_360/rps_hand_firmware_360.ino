/*
 * Mao Robotica Pedra-Papel-Tesoura - Firmware Arduino Uno
 * Variante para servos SG90 de ROTACAO CONTINUA (360 graus).
 * Para servo posicional comum (180 graus), use o outro sketch:
 * firmware/rps_hand_firmware_180/rps_hand_firmware_180.ino
 *
 * Recebe comandos via serial (115200 bps, texto terminado em '\n') enviados
 * pela pagina web (Web Serial API), um servo por dedo.
 *
 * Servo de rotacao continua nao tem posicao: escrever um valor so define
 * velocidade/sentido de giro, ele nunca "segura" um angulo. Por isso cada
 * dedo e controlado por PULSO CRONOMETRADO (gira no valor pedido por N ms e
 * volta pro valor de "parado"), contando com um batente mecanico no fim do
 * curso de abertura para servir de referencia (homing): a mao sempre volta
 * pra aberta antes de formar um gesto novo, entao pequenos erros de tempo no
 * fechamento nao se acumulam de um gesto pro proximo.
 *
 * O firmware e totalmente "stateless" quanto a calibracao: o valor bruto do
 * servo (sentido/velocidade) e a duracao de cada pulso vem prontos da pagina
 * a cada comando -- nao ha nada de "abrir"/"fechar" fixo aqui, tudo se ajusta
 * na aba Calibracao do navegador (selecionar tipo de servo "360°"), sem
 * precisar regravar o Arduino.
 *
 * Protocolo:
 *   P                              -> responde "OK" (ping / teste de presenca)
 *   T p0,p1,p2,p3,p4               -> define o valor de "parado" (trim) de
 *                                      cada servo (raw 0-180, fica em RAM)
 *   Z v0:d0,v1:d1,...,v4:d4        -> pulso de "zero"/abertura de cada dedo
 *   M v0:d0,v1:d1,...,v4:d4        -> pulso do gesto final de cada dedo
 * Ordem dos dedos: polegar, indicador, medio, anelar, mindinho.
 * Em cada par "v:d": v = valor bruto do servo (0-180, velocidade+sentido)
 * enquanto o pulso dura; d = duracao do pulso em ms (0 = nao se move, so
 * garante que fica no valor de parado).
 *
 * Posicao inicial: ao ligar (ou ao resetar quando o navegador abre a porta
 * serial), o firmware faz sozinho um pulso de abertura "generico" (valor e
 * duracao abaixo) ANTES de a pagina se conectar e mandar a calibracao real
 * -- so para garantir que a mao comeca sempre aberta mesmo sem navegador.
 * Assim que a pagina conecta, ela reenvia T e Z com os valores calibrados
 * de verdade, corrigindo qualquer imprecisao desse chute inicial.
 *
 * Alimentacao: servos em fonte externa 5V (NAO usar o 5V do Arduino para os
 * 5 servos), com GND comum entre a fonte externa e o Arduino.
 */

#include <Servo.h>

const uint8_t PIN_POLEGAR   = 3;
const uint8_t PIN_INDICADOR = 5;
const uint8_t PIN_MEDIO     = 6;
const uint8_t PIN_ANELAR    = 9;
const uint8_t PIN_MINDINHO  = 10;

const uint8_t NUM_DEDOS = 5;
const uint8_t PINS[NUM_DEDOS] = { PIN_POLEGAR, PIN_INDICADOR, PIN_MEDIO, PIN_ANELAR, PIN_MINDINHO };

// Chute inicial usado so no boot, antes de a pagina mandar a calibracao real
// (ver comentario acima). 180 e um extremo de velocidade -- se a mao nao
// abrir no boot com este valor, o sentido fisico de algum dedo esta
// invertido; isso se corrige na pagina (aba Calibracao), nao aqui.
const uint8_t HOMING_VALOR_PADRAO = 180;
const unsigned long HOMING_MS_PADRAO = 1000;
const uint8_t PARADO_PADRAO = 90;

// Duracao maxima de um pulso, por seguranca (evita comando invalido travar
// o motor girando por minutos).
const int DURACAO_MAX_MS = 3000;

Servo servos[NUM_DEDOS];
uint8_t valorParado[NUM_DEDOS];
unsigned long paradaEm[NUM_DEDOS];
bool movendo[NUM_DEDOS];

String linhaSerial;

void setup() {
  Serial.begin(115200);

  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    valorParado[i] = PARADO_PADRAO;
    servos[i].attach(PINS[i]);
    servos[i].write(HOMING_VALOR_PADRAO);
  }
  delay(HOMING_MS_PADRAO);
  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    servos[i].write(valorParado[i]);
    movendo[i] = false;
  }

  linhaSerial.reserve(64);
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      processarComando(linhaSerial);
      linhaSerial = "";
    } else if (c != '\r') {
      linhaSerial += c;
    }
  }

  atualizarParadas();
}

// Para cada servo em movimento, verifica se ja passou do tempo do pulso e,
// se sim, manda o valor de parado. Nao-bloqueante: os 5 dedos podem estar
// girando ao mesmo tempo, cada um parando no seu proprio instante.
void atualizarParadas() {
  unsigned long agora = millis();
  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    if (movendo[i] && (long)(agora - paradaEm[i]) >= 0) {
      servos[i].write(valorParado[i]);
      movendo[i] = false;
    }
  }
}

void processarComando(const String &linha) {
  if (linha.length() == 0) {
    return;
  }

  char comando = linha.charAt(0);

  if (comando == 'P') {
    Serial.println("OK");
    return;
  }

  if (comando == 'T') {
    int trims[NUM_DEDOS];
    if (extrairCincoInteiros(linha, trims)) {
      for (uint8_t i = 0; i < NUM_DEDOS; i++) {
        valorParado[i] = (uint8_t)constrain(trims[i], 0, 180);
        if (!movendo[i]) {
          servos[i].write(valorParado[i]);
        }
      }
      Serial.println("OK");
    } else {
      Serial.println("ERR");
    }
    return;
  }

  if (comando == 'Z' || comando == 'M') {
    int valores[NUM_DEDOS];
    int duracoes[NUM_DEDOS];
    if (extrairCincoPulsos(linha, valores, duracoes)) {
      moverServos(valores, duracoes);
      Serial.println("OK");
    } else {
      Serial.println("ERR");
    }
    return;
  }

  Serial.println("ERR");
}

// Espera algo como "T 90,90,88,90,92" (a partir do indice 1, pulando o
// espaco): 5 inteiros separados por virgula.
bool extrairCincoInteiros(const String &linha, int valores[NUM_DEDOS]) {
  int inicioNumeros = linha.indexOf(' ');
  if (inicioNumeros < 0) {
    return false;
  }

  String resto = linha.substring(inicioNumeros + 1);
  int indiceAtual = 0;

  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    int virgula = resto.indexOf(',', indiceAtual);
    String token = (i < NUM_DEDOS - 1)
      ? resto.substring(indiceAtual, virgula)
      : resto.substring(indiceAtual);

    if (i < NUM_DEDOS - 1 && virgula < 0) {
      return false;
    }

    token.trim();
    if (token.length() == 0) {
      return false;
    }

    valores[i] = token.toInt();
    indiceAtual = virgula + 1;
  }

  return true;
}

// Espera algo como "M 180:500,0:400,0:400,180:0,180:0" (a partir do indice
// 1, pulando o espaco): 5 pares "valor:duracao" separados por virgula.
bool extrairCincoPulsos(const String &linha, int valores[NUM_DEDOS], int duracoes[NUM_DEDOS]) {
  int inicioNumeros = linha.indexOf(' ');
  if (inicioNumeros < 0) {
    return false;
  }

  String resto = linha.substring(inicioNumeros + 1);
  int indiceAtual = 0;

  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    int virgula = resto.indexOf(',', indiceAtual);
    String token = (i < NUM_DEDOS - 1)
      ? resto.substring(indiceAtual, virgula)
      : resto.substring(indiceAtual);

    if (i < NUM_DEDOS - 1 && virgula < 0) {
      return false;
    }

    token.trim();
    int doisPontos = token.indexOf(':');
    if (doisPontos < 0) {
      return false;
    }

    String tokenValor = token.substring(0, doisPontos);
    String tokenDuracao = token.substring(doisPontos + 1);
    tokenValor.trim();
    tokenDuracao.trim();
    if (tokenValor.length() == 0 || tokenDuracao.length() == 0) {
      return false;
    }

    valores[i] = constrain(tokenValor.toInt(), 0, 180);
    duracoes[i] = constrain(tokenDuracao.toInt(), 0, DURACAO_MAX_MS);
    indiceAtual = virgula + 1;
  }

  return true;
}

void moverServos(const int valores[NUM_DEDOS], const int duracoes[NUM_DEDOS]) {
  unsigned long agora = millis();
  for (uint8_t i = 0; i < NUM_DEDOS; i++) {
    int d = duracoes[i];
    if (d <= 0) {
      servos[i].write(valorParado[i]);
      movendo[i] = false;
      continue;
    }
    servos[i].write((uint8_t)valores[i]);
    paradaEm[i] = agora + (unsigned long)d;
    movendo[i] = true;
  }
}
