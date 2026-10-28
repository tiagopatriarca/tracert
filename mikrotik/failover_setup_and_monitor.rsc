# =======================================================================
# SCRIPT: FAILOVER_SETUP_AND_MONITOR (TRACERT+ OFICIAL v8 UNIVERSAL)
# Suporta: RouterOS v6 e RouterOS v7
# Padrão de Identificação: Comentário em /ip route iniciando com "LINK - "
# =======================================================================

# --- CONFIGURACAO DO TRACERT+ ---
:local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
:local routerToken "MK-ARO-MATRIZ-01"   ;# Substitua pelo Token da RB no TRACERT+

# =======================================================================
# 1. LIMPEZA SEGURA DE REGRAS ANTERIORES
# =======================================================================
:foreach r in=[/ip route find comment~"!=="] do={ :do { /ip route remove $r } on-error={} }
:do { :foreach r in=[/routing rule find comment~"!=="] do={ :do { /routing rule remove $r } on-error={} } } on-error={}
:do { :foreach r in=[/ip route rule find comment~"!=="] do={ :do { /ip route rule remove $r } on-error={} } } on-error={}
:do { :foreach t in=[/routing table find name~"rota-de-teste"] do={ :do { /routing table remove $t } on-error={} } } on-error={}
:do { /system script remove [find name="tracert_link_monitor"] } on-error={}
:do { /system scheduler remove [find name="executa_tracert_link_monitor"] } on-error={}
:do { /system script remove [find name="failover"] } on-error={}
:do { /system script remove [find name="FAILOVER_ACTIONS"] } on-error={}
:do { /system scheduler remove [find name="executa script failover"] } on-error={}

# =======================================================================
# 2. CONFIGURACAO DA ACAO FAILOVER_ACTIONS
# =======================================================================
/system script add dont-require-permissions=no name="FAILOVER_ACTIONS" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # =============== VARIAVEIS GERAIS =====================================
    :global comentario
    :local comentarioActions $comentario
    :local hashPos [:find $comentario "#"]
    :if ([:typeof $hashPos] = "num") do={
        :set comentarioActions [:pick $comentario 0 $hashPos]
    }

    :global LinkStatus
    :global LinkState
    :local LinkStateActions $LinkState
    :global emoji
    :global routerName [/system identity get name]
    :global foPingScore
    :if ([:typeof $foPingScore] != "num") do={
        :if ($LinkStateActions > 0) do={ :global foPingScore 8 } else={ :global foPingScore 0 }
    }

    :if ($LinkStateActions > 0) do={
        :global emoji "%F0%9F%9F%A2"
        :global LinkStatus "UP"
    } else={
        :global emoji "%F0%9F%94%B4"
        :global LinkStatus "DOWN"
    }

    # =============== GERAR LOG LOCAL =====================================
    /log warning message=("[FAILOVER] LINK: " . $comentarioActions . " -- STATUS: " . $LinkStatus . " (Score: " . [:tostr $foPingScore] . "/8)")

    # =============== ENVIO TRACERT+ (DISPARA ALERTA EVOLUTION API) ========
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
    :local routerToken "MK-ARO-MATRIZ-01"   ;# Insira o Token da sua RB
    :local payload ("token=" . $routerToken . "&link=" . $comentarioActions . "&status=" . $LinkStatus . "&score=" . [:tostr $foPingScore])

    :do {
        /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
    } on-error={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        } on-error={
            /log error message=("[FAILOVER] Falha ao enviar telemetria para a API do TRACERT+")
        }
    }

    # =============== ENVIO TELEGRAM (OPCIONAL) ===========================
    :global botToken "----"
    :global groupID "--------"
    :if ($botToken != "----" and [:len $botToken] > 0 and $groupID != "--------" and [:len $groupID] > 0) do={
        :delay 2
        :do {
            /tool fetch check-certificate=no url=("https://api.telegram.org/bot" . $botToken . "/sendMessage?chat_id=" . $groupID . "&parse_mode=HTML&text=" . $emoji . $emoji . $emoji . $emoji . "%0A%0A<b>ROTEADOR:</b> " . $routerName . "%0A%0A<b>LINK:</b> " . $comentarioActions . "%0A%0A<b>STATUS:</b> " . $LinkStatus . "%0A____________________________") keep-result=no
        } on-error={}
    }

    # =============== ENVIO GOOGLE SHEETS (OPCIONAL) ======================
    :global urlGoogleSheets "==========="
    :global sheetName "REGISTROS"
    :if ($urlGoogleSheets != "===========" and [:len $urlGoogleSheets] > 0) do={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/json" url=$urlGoogleSheets http-data=("{\"sheet\":\"" . $sheetName . "\",\"ROTEADOR\":\"" . $routerName . "\",\"LINK\":\"" . $comentarioActions . "\",\"STATUS\":\"" . $LinkStatus . "\"}") keep-result=no
        } on-error={}
    }
}

# =======================================================================
# 3. SETUP DINAMICO DE TABELAS E ROTAS DE TESTE (VIA COMENTARIO "LINK - ")
# =======================================================================
:foreach i in=[/ip route find dst-address=0.0.0.0/0] do={
    :local cmt [/ip route get $i comment]
    :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
        :local gw [/ip route get $i gateway]
        :local cleanName $cmt
        :local hashPos [:find $cmt "#"]
        :if ([:typeof $hashPos] = "num") do={
            :set cleanName [:pick $cmt 0 $hashPos]
        }

        :local safeCmt ""
        :for idx from=0 to=([:len $cleanName] - 1) do={
            :local char [:pick $cleanName $idx ($idx + 1)]
            :if ($char = " " or $char = "/" or $char = ":" or $char = "_") do={ :set char "-" }
            :set safeCmt ($safeCmt . $char)
        }

        :local tabName ("rota-de-teste-para-" . $safeCmt)

        :do {
            /routing table add name=$tabName fib
        } on-error={}

        :do {
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-table=$tabName comment=("!== Rota de teste para " . $cleanName)
        } on-error={
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-mark=$tabName comment=("!== Rota de teste para " . $cleanName)
        }

        :do {
            /routing rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cleanName)
        } on-error={
            :do { /ip route rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cleanName) } on-error={}
        }

        # Notifica imediatamente o TRACERT+ da existência do link e seu estado inicial
        :local isDis [/ip route get $i disabled]
        :local initStatus "UP"
        :local initScore 8
        :if ($isDis = true) do={ :set initStatus "DOWN"; :set initScore 0 }
        :local payload ("token=" . $routerToken . "&link=" . $cleanName . "&status=" . $initStatus . "&score=" . [:tostr $initScore])
        :do {
            /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        } on-error={}
    }
}

# =======================================================================
# 4. SCRIPT DE MONITORAMENTO DE FAILOVER
# =======================================================================
/system script add dont-require-permissions=no name="failover" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local IPsParaTeste [:toarray "8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8"]
    :local NumeroDePings 2
    :local Intervalo 00:00:00.5
    :local ScoreMinimoUP 3

    :global comentario
    :global LinkState
    :global LinkStatus
    :global emoji
    :global routerName [/system identity get name]
    :global foPingScore
    :global foLinkName
    :global foLinkStatus

    # Conta o total de rotas ativas (habilitadas) de operadora
    :local totalRotasAtivas 0
    :foreach i in=[/ip route find dst-address=0.0.0.0/0 disabled=no] do={
        :local cmt [/ip route get $i comment]
        :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
            :set totalRotasAtivas ($totalRotasAtivas + 1)
        }
    }

    # Percorre cada link de operadora
    :foreach i in=[/ip route find dst-address=0.0.0.0/0] do={
        :local cmt [/ip route get $i comment]
        :if ([:len $cmt] > 0 and ($cmt ~ "[Ll][Ii][Nn][Kk]") and !($cmt ~ "!==")) do={
            :delay 1
            :local cleanName $cmt
            :local hashPos [:find $cmt "#"]
            :if ([:typeof $hashPos] = "num") do={
                :set cleanName [:pick $cmt 0 $hashPos]
            }

            :local safeCmt ""
            :for idx from=0 to=([:len $cleanName] - 1) do={
                :local char [:pick $cleanName $idx ($idx + 1)]
                :if ($char = " " or $char = "/" or $char = ":" or $char = "_") do={ :set char "-" }
                :set safeCmt ($safeCmt . $char)
            }
            :local TabRoteAtual ("rota-de-teste-para-" . $safeCmt)
            :local scoreAtual 0
            :local rGw [/ip route get $i gateway]
            :local ifaceName $rGw
            :do {
                :local immGw [/ip route get $i immediate-gw]
                :local pctPos [:find $immGw "%"]
                :if ([:typeof $pctPos] = "num") do={
                    :set ifaceName [:pick $immGw ($pctPos + 1) [:len $immGw]]
                }
            } on-error={}

            :foreach ip in=$IPsParaTeste do={
                :local res 0
                :do {
                    :set res [/ping $ip count=$NumeroDePings interval=$Intervalo routing-table=$TabRoteAtual]
                } on-error={
                    :do {
                        :set res [/ping $ip count=$NumeroDePings interval=$Intervalo interface=$ifaceName]
                    } on-error={ :set res 0 }
                }
                :set scoreAtual ($scoreAtual + $res)
            }

            :local isDis [/ip route get $i disabled]

            # SE O LINK FALHOU (score < ScoreMinimoUP) e a rota estava ATIVA (disabled=no)
            :if ($scoreAtual < $ScoreMinimoUP and $isDis = false) do={
                :if ($totalRotasAtivas > 1) do={
                    /ip route disable [find dst-address=0.0.0.0/0 and comment=$cmt and !comment~"!=="]
                    :set totalRotasAtivas ($totalRotasAtivas - 1)
                    :set comentario $cmt
                    :set LinkState 0
                    :set LinkStatus "DOWN"
                    :set foLinkName $cleanName
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                } else={
                    /log warning message=("[FAILOVER] Link " . $cmt . " falhou (Score " . [:tostr $scoreAtual] . "/8), mantido ativo por ser o unico restante!")
                    :set comentario $cmt
                    :set LinkState 0
                    :set LinkStatus "DOWN"
                    :set foLinkName $cleanName
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                }
            }

            # SE O LINK RECUPEROU (score >= ScoreMinimoUP) e a rota estava DESATIVADA (disabled=yes)
            :if ($scoreAtual >= $ScoreMinimoUP and $isDis = true) do={
                /ip route enable [find dst-address=0.0.0.0/0 and comment=$cmt and !comment~"!=="]
                :set totalRotasAtivas ($totalRotasAtivas + 1)
                :set comentario $cmt
                :set LinkState 1
                :set LinkStatus "UP"
                :set foLinkName $cleanName
                :set foLinkStatus "UP"
                :set foPingScore $scoreAtual
                :do { /system script run FAILOVER_ACTIONS } on-error={}
            }
        }
    }
}

# =======================================================================
# 5. AGENDADOR (EXECUTA A CADA 30 SEGUNDOS)
# =======================================================================
/system scheduler add interval=30s name="executa script failover" on-event="failover" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# Executa imediatamente a primeira checagem para publicar os links
:do { /system script run failover } on-error={}
:log info message="[TRACERT+] Failover Multi-Link v8 (LINK - OPERADORA) provisionado e sincronizado!";
