/*
 * Mao Robotica Pedra-Papel-Tesoura - Firmware Arduino Uno
 * Variante para servos SG90 POSICIONAIS comuns (180 graus).
 * Para servo de rotacao continua (360 graus), use o outro sketch:
 * firmware/rps_hand_firmware_360/rps_hand_firmware_360.ino
 *
 * Recebe comandos via serial (115200 bps, texto terminado em '\n') enviados
 * pela pagina web (Web Serial API) e move 5 servos SG90, um por dedo.
 *
 * Servo posicional segura o angulo escrito (0-180) -- diferente do de
 * rotacao continua, aqui o valor recebido JA E a posicao final do dedo,
 * sem pulso cronometrado.
 *
 * Protocolo:
 *   P                          -> responde "OK" (ping / teste de presenca)
 *   Z a0,a1,a2,a3,a4           -> vai para a posicao "zero" (angulos 0-180)
 *   M a0,a1,a2,a3,a4           -> vai para os angulos finais do gesto (0-180)
 * Ordem dos angulos: polegar, indicador, medio, anelar, mindinho.
 *
 * Posicao inicial: ao ligar (ou ao resetar quando o navegador abre a porta
 * serial), o firmware move sozinho para ANGULO_ZERO_PADRAO (chute de
 * "aberto" antes de a pagina conectar). Assim que a pagina conecta, ela
 * reenvia "Z" com o angulo de zero calibrado de verdade (aba Calibracao),
 * corrigindo qualquer imprecisao desse chute inicial.
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

const uint8_t ANGULO_ZERO_PADRAO = 0; // chute de posicao "aberta" ao ligar, antes de a pagina conectar

Servo servoPolegar;
Servo servoIndicador;
Servo servoMedio;
Servo servoAnelar;
Servo servoMindinho;

String linhaSerial;

void setup() {
  Serial.begin(115200);

  servoPolegar.attach(PIN_POLEGAR);
  servoIndicador.attach(PIN_INDICADOR);
  servoMedio.attach(PIN_MEDIO);
  servoAnelar.attach(PIN_ANELAR);
  servoMindinho.attach(PIN_MINDINHO);

  moverServos(ANGULO_ZERO_PADRAO, ANGULO_ZERO_PADRAO, ANGULO_ZERO_PADRAO,
              ANGULO_ZERO_PADRAO, ANGULO_ZERO_PADRAO);

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

  if (comando == 'Z' || comando == 'M') {
    int angulos[5];
    if (extrairCincoAngulos(linha, angulos)) {
      moverServos(angulos[0], angulos[1], angulos[2], angulos[3], angulos[4]);
      Serial.println("OK");
    } else {
      Serial.println("ERR");
    }
    return;
  }

  Serial.println("ERR");
}

// Espera algo como "M 10,20,30,40,50" (a partir do indice 1, pulando o espaco)
bool extrairCincoAngulos(const String &linha, int angulos[5]) {
  int inicioNumeros = linha.indexOf(' ');
  if (inicioNumeros < 0) {
    return false;
  }

  String valores = linha.substring(inicioNumeros + 1);
  int indiceAtual = 0;

  for (int i = 0; i < 5; i++) {
    int virgula = valores.indexOf(',', indiceAtual);
    String token = (i < 4)
      ? valores.substring(indiceAtual, virgula)
      : valores.substring(indiceAtual);

    if (i < 4 && virgula < 0) {
      return false;
    }

    token.trim();
    if (token.length() == 0) {
      return false;
    }

    angulos[i] = constrain(token.toInt(), 0, 180);
    indiceAtual = virgula + 1;
  }

  return true;
}

void moverServos(int aPolegar, int aIndicador, int aMedio, int aAnelar, int aMindinho) {
  servoPolegar.write(aPolegar);
  servoIndicador.write(aIndicador);
  servoMedio.write(aMedio);
  servoAnelar.write(aAnelar);
  servoMindinho.write(aMindinho);
}
