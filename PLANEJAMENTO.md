# Mão Robótica Pedra-Papel-Tesoura — Planejamento

Projeto: Arduino Uno + 5 micro servos SG90 de **rotação contínua (360°)** (um
por dedo) formam pedra, papel ou tesoura de acordo com o gesto da mão do
usuário, capturado pela câmera do computador em uma página web **estática**
(sem backend). Os parâmetros de calibração ficam salvos no `localStorage` do
navegador.

Servo de rotação contínua não tem posição própria — escrever um valor só
define velocidade/sentido de giro, ele nunca "segura" um ângulo. Por isso
cada dedo é controlado por **pulso cronometrado** (gira N ms num sentido e
para), contando com um **batente mecânico** no fim do curso de abertura como
referência: o fluxo sempre manda `Z` (abrir/zerar, indo até o batente) antes
de `M` (gesto final), então cada ciclo começa de uma referência conhecida e
pequenos erros de tempo no fechamento não se acumulam de um gesto pro
próximo.

## 1. Pesquisa / decisões técnicas

| Necessidade | Solução escolhida | Por quê |
|---|---|---|
| Navegador falar com o Arduino via USB, sem backend | **Web Serial API** (`navigator.serial`) | Roda 100% no cliente, sem servidor. Suportado em Chrome/Edge/Opera desktop 89+. **Não** suportado em Firefox estável nem Safari. |
| Reconhecer mão / classificar pedra-papel-tesoura pela câmera, sem backend | **MediaPipe Tasks Vision – HandLandmarker** via CDN (`@mediapipe/tasks-vision`) | Roda no navegador (WASM/WebGL), retorna 21 pontos (landmarks) da mão em tempo real. Existe inclusive um exemplo oficial do Google de "Rock-paper-scissors com MediaPipe Tasks", confirmando que dá para classificar o gesto só com a posição dos landmarks (sem treinar modelo próprio). |
| Contexto seguro exigido pelo navegador | Tanto `navigator.serial` quanto `navigator.mediaDevices.getUserMedia` (câmera) só funcionam em **contexto seguro**: `https://` ou `http://localhost`. Abrir o `index.html` direto com duplo-clique (`file://`) pode falhar. | Servir a pasta `web/` com qualquer servidor estático local (`python -m http.server`, `npx serve`, Live Server do VSCode, etc.) ou publicar em hospedagem estática HTTPS (GitHub Pages, Netlify...). |
| Alimentação de 5 servos SG90 simultâneos | **Fonte externa 5V (min. 2A)** para os servos, Arduino alimentado por USB, **GND comum** entre a fonte externa e o Arduino. Capacitor eletrolítico 470–1000 µF entre + e - perto dos servos ajuda a absorver o pico de corrente. | Cada SG90 pode puxar até ~500 mA de pico na partida; alimentar 5 pelo pino 5V do Arduino (via USB) causa *brownout* (reset) do Arduino. Fórum do Arduino e guias de SG90 confirmam essa prática. |

## 2. Arquitetura

```
[Câmera do PC] --getUserMedia--> [Navegador: index.html/app.js]
                                         |
                             MediaPipe HandLandmarker
                             (21 landmarks da mão)
                                         |
                              Classificador Pedra/Papel/Tesoura
                              (regras geométricas nos landmarks)
                                         |
                         Mapeamento gesto -> ângulo de cada servo
                         (usa calibração salva no localStorage)
                                         |
                              Web Serial API (USB, 115200 bps)
                                         |
                              [Arduino Uno + Servo.h]
                                         |
                        5x SG90 (polegar, indicador, médio, anelar, mindinho)
```

Fluxo de acionamento (garante que a mão sempre passa pela posição zero):
1. Classificador decide o gesto (pedra / papel / tesoura) com um tempo mínimo
   de estabilidade (debounce) para evitar tremulação.
2. App envia comando `Z` (zero) → todos os dedos vão para o ângulo neutro
   calibrado.
3. Após um pequeno atraso configurável, o app envia `M` com os 5 ângulos
   finais do gesto.
4. Enquanto o gesto detectado não mudar, nada é reenviado (evita "tremer" o
   servo). Se a mão sair de quadro, some/gesto desconhecido → volta para zero.

## 3. Protocolo serial (texto, terminado em `\n`, 115200 bps)

| Comando enviado pelo navegador | Efeito no Arduino | Resposta |
|---|---|---|
| `P` | Ping / verifica presença | `OK` |
| `Z d0,d1,d2,d3,d4` | Pulsa os 5 servos no sentido "zero"/abertura pelo tempo (ms) informado | `OK` |
| `M d0,d1,d2,d3,d4` | Pulsa os 5 servos (polegar, indicador, médio, anelar, mindinho) pelo tempo (ms) do gesto final | `OK` |

Cada `di` é um tempo em milissegundos, com sinal: positivo gira no sentido
"abrir" por `di` ms, negativo gira no sentido "fechar" por `|di|` ms, e `0`
significa não se mover. Os sentidos "abrir"/"fechar" de cada servo (qual
valor de PWM corresponde a qual direção) ficam fixos no firmware
(`VALOR_ABRIR`/`VALOR_FECHAR`), pois dependem de como o servo foi montado
fisicamente — só o **tempo** de cada pulso é calibrado pela página.

O Arduino é **stateless** quanto à calibração: ele só recebe tempos de pulso
já calculados pela página (que sabe o tempo "aberto" e "fechado" de cada
servo, calibrado pelo usuário). Isso evita ter que reprogramar o Arduino ao
ajustar a calibração — tudo se ajusta na página e fica salvo em
`localStorage`.

## 4. Classificação do gesto (regras nos landmarks da mão)

Para cada um dos 5 dedos, comparar a distância da ponta do dedo ao pulso
(landmark 0) com a distância da junta intermediária correspondente ao pulso
(PIP para indicador/médio/anelar/mindinho; MCP para o polegar):
`distância(ponta, pulso) > distância(junta, pulso)` ⇒ dedo **estendido**.
Essa comparação por distância (em vez de só a coordenada Y ou X) é robusta a
rotação/inclinação da mão e não depende de saber se é a mão esquerda ou
direita, então dispensa usar o dado de "handedness" do MediaPipe.

Classificação (só olha indicador/médio/anelar/mindinho; polegar é ignorado
na detecção, mas ainda é comandado no acionamento — ver mapeamento abaixo):
- **Pedra**: indicador, médio, anelar e mindinho fechados (punho).
- **Papel**: indicador, médio, anelar e mindinho estendidos.
- **Tesoura**: indicador e médio estendidos; anelar e mindinho fechados.
- Qualquer outra combinação: gesto "indefinido" → mão volta para zero e
  aguarda.

Mapeamento gesto → estado alvo de cada servo (usado para calcular o ângulo
final com `open`/`closed` da calibração):

| Gesto | Polegar | Indicador | Médio | Anelar | Mindinho |
|---|---|---|---|---|---|
| Pedra | fechado | fechado | fechado | fechado | fechado |
| Papel | aberto | aberto | aberto | aberto | aberto |
| Tesoura | fechado | aberto | aberto | fechado | fechado |

## 5. Parâmetros salvos no `localStorage` (chave `rps_hand_config_v1`)

```json
{
  "baudRate": 115200,
  "zeroDelayMs": 250,
  "holdMs": 400,
  "servos": {
    "polegar":   { "zero": 500, "open": 0, "closed": -500 },
    "indicador": { "zero": 500, "open": 0, "closed": -500 },
    "medio":     { "zero": 500, "open": 0, "closed": -500 },
    "anelar":    { "zero": 500, "open": 0, "closed": -500 },
    "mindinho":  { "zero": 500, "open": 0, "closed": -500 }
  }
}
```
- `open` / `closed`: tempo de pulso (ms, com sinal) do servo para dedo
  estendido / fechado — ajustável na aba de calibração, pois cada dedo pode
  precisar de um tempo diferente até o batente.
- `zero`: tempo de pulso de repouso ("posição zero", tipicamente igual ao
  tempo de abertura) — mão sempre passa por aqui antes de formar um gesto
  novo, o que serve de referência (homing) contra o batente mecânico.
- `holdMs`: tempo que o gesto precisa se manter estável antes de acionar
  (debounce, evita ficar mudando o servo o tempo todo).
- `zeroDelayMs`: atraso entre mandar ir para zero e mandar o gesto final.

## 6. Estrutura de arquivos

```
rps_hand/
├── PLANEJAMENTO.md
├── docker-compose.yml               # Sobe o nginx local (porta 8081)
├── .github/workflows/
│   └── deploy-pages.yml             # Publica web/ no GitHub Pages a cada push em main
├── firmware/
│   └── rps_hand_firmware/
│       └── rps_hand_firmware.ino    # Firmware do Arduino Uno
└── web/
    ├── index.html                   # Página estática (UI + conexão + calibração)
    ├── style.css
    ├── app.js                       # Lógica: câmera, MediaPipe, classificador, Web Serial
    ├── Dockerfile                   # Imagem nginx:alpine servindo estes arquivos
    ├── nginx.conf                   # Config mínima do nginx
    └── .dockerignore
```

Todos os caminhos em `index.html`/`app.js` são **relativos** (`style.css`,
`app.js`, sem `/` na frente), então o mesmo `web/` funciona sem alterações
tanto servido na raiz (`http://localhost:8081/`) quanto num subcaminho de
projeto do GitHub Pages (`https://usuario.github.io/repositorio/`).

## 7. Ligações (wiring)

- Servo **polegar**    → pino digital **D3**  (sinal, fio laranja/amarelo)
- Servo **indicador**  → pino digital **D5**
- Servo **médio**      → pino digital **D6**
- Servo **anelar**     → pino digital **D9**
- Servo **mindinho**   → pino digital **D10**
- Todos os fios **vermelhos (V+)** dos servos → **fonte externa 5V** (não o
  5V do Arduino).
- Todos os fios **marrons/pretos (GND)** dos servos → **GND da fonte
  externa** e também ao **GND do Arduino** (referência comum obrigatória).
- Capacitor 470–1000 µF entre + e - da fonte externa, perto dos servos.

## 8. Como rodar

1. Abrir `firmware/rps_hand_firmware/rps_hand_firmware.ino` na Arduino IDE,
   selecionar placa "Arduino Uno" e a porta serial, e gravar.
2. Servir a pasta `web/` localmente. Duas opções equivalentes:

   **Opção A — Docker + nginx (testado nesta máquina):**
   ```
   cd rps_hand
   docker compose up -d --build
   ```
   Abre em `http://localhost:8081`. Para parar: `docker compose down`.
   Para ver logs: `docker compose logs -f`.

   **Opção B — servidor Python (sem Docker):**
   ```
   cd rps_hand/web
   python3 -m http.server 8080
   ```
   Abre em `http://localhost:8080`.

   Em ambos os casos, use **Google Chrome** ou **Microsoft Edge** (Web
   Serial não funciona no Firefox/Safari). A conexão USB com o Arduino é
   feita pelo navegador rodando na máquina física conectada ao Arduino —
   isso vale tanto para a versão local (Docker/Python) quanto para a versão
   publicada no GitHub Pages (item 8.1): o que importa é em qual computador
   o **navegador** está aberto, não onde a página está hospedada.
3. Na página: clicar em **"Conectar Arduino"** e escolher a porta serial;
   permitir acesso à **câmera** quando solicitado.
4. Na aba **Calibração**, ajustar os tempos de pulso (ms) `open`/`closed`/`zero`
   de cada servo até os dedos abrirem/fecharem corretamente contra o batente
   e salvar (fica no `localStorage`, sobrevive a fechar o navegador).
5. Mostrar a mão para a câmera — a mão robótica deve refletir o gesto
   (pedra, papel ou tesoura), sempre passando pela posição zero entre um
   gesto e outro.

### 8.1 Publicar no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` já está pronto: a cada push
na branch `main` que altere algo em `web/`, ele publica o conteúdo de `web/`
no GitHub Pages automaticamente (usa `actions/upload-pages-artifact` +
`actions/deploy-pages`, sem precisar de branch `gh-pages` manual).

Passos (uma vez só):
1. Criar o repositório no GitHub e dar push neste projeto (`rps_hand/`) para
   a branch `main`.
2. No repositório: **Settings → Pages → Source → "GitHub Actions"**.
3. Fazer um push (ou rodar o workflow manualmente em Actions →
   "Deploy web/ to GitHub Pages" → Run workflow). A URL publicada aparece em
   Settings → Pages, algo como `https://<usuario>.github.io/<repo>/`.

GitHub Pages serve tudo via HTTPS, então tanto a câmera quanto a Web Serial
API funcionam normalmente lá — a única exigência continua sendo abrir a
página publicada em Chrome/Edge/Opera no computador que está com o Arduino
ligado na USB.

## 9. Limitações conhecidas

- Web Serial exige Chrome/Edge/Opera desktop; não há suporte em
  Firefox/Safari estáveis nem na maioria dos navegadores mobile.
- Iluminação ruim ou mão parcialmente fora do quadro reduz a precisão do
  MediaPipe.
- O classificador é baseado em regras geométricas simples — funciona bem
  para os 3 gestos clássicos, mas não é um classificador de propósito geral.
- Cada aba do navegador só pode manter uma conexão serial por vez com a
  porta; é preciso desconectar antes de abrir o Serial Monitor da Arduino
  IDE, por exemplo.
- Com servo de rotação contínua, se um dedo abrir/fechar no sentido trocado,
  o ajuste é no firmware (`VALOR_ABRIR`/`VALOR_FECHAR` em
  `rps_hand_firmware.ino`), não na página — inverta o par daquele dedo e
  regrave. Se um dedo ficar girando devagar mesmo parado, ajuste o
  `VALOR_PARADO` daquele servo (normalmente perto de 90, varia por unidade).
