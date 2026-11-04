# =======================================================================
# SCRIPT: FAILOVER_SETUP_AND_MONITOR (TRACERT+ OFICIAL - ROUTEROS v7)
# Compatibilidade: MikroTik RouterOS v7.1 até v7.16+
# Padrão de Identificação: Comentário em /ip route iniciando com "LINK - "
# =======================================================================

# --- CONFIGURACAO DO TRACERT+ ---
:local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
:local routerToken "SEU_TOKEN_AQUI"   ;# Substitua pelo Token da RB no TRACERT+

# =======================================================================
# 1. LIMPEZA SEGURA DE REGRAS ANTERIORES (ROUTEROS v7)
# =======================================================================
:do { /system script remove [find name="tracert_link_monitor"] } on-error={}
:do { /system scheduler remove [find name="executa_tracert_link_monitor"] } on-error={}
:foreach r in=[/ip route find comment~"!=="] do={ :do { /ip route remove $r } on-error={} }
:do { :foreach r in=[/routing rule find comment~"!=="] do={ :do { /routing rule remove $r } on-error={} } } on-error={}
:do { :foreach t in=[/routing table find name~"rota-de-teste"] do={ :do { /routing table remove $t } on-error={} } } on-error={}
:do { /system script remove [find name="failover"] } on-error={}
:do { /system script remove [find name="FAILOVER_ACTIONS"] } on-error={}
:do { /system scheduler remove [find name="executa script failover"] } on-error={}

# =======================================================================
# 2. CONFIGURACAO DA ACAO FAILOVER_ACTIONS
# =======================================================================
/system script add dont-require-permissions=no name="FAILOVER_ACTIONS" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :global foLinkName
    :global comentario
    :local linkFinal $foLinkName
    :if ([:len $linkFinal] = 0) do={ :set linkFinal $comentario }
    :local hashPos [:find $linkFinal "#"]
    :if ([:typeof $hashPos] = "num") do={
        :set linkFinal [:pick $linkFinal 0 $hashPos]
    }

    :global foLinkStatus
    :global LinkStatus
    :global LinkState
    :local statusFinal $foLinkStatus
    :if ([:len $statusFinal] = 0) do={ :set statusFinal $LinkStatus }
    :if ([:len $statusFinal] = 0) do={
        :if ($LinkState > 0) do={ :set statusFinal "UP" } else={ :set statusFinal "DOWN" }
    }

    :global foPingScore
    :local scoreFinal $foPingScore
    :if ([:typeof $scoreFinal] != "num") do={
        :if ($statusFinal = "UP") do={ :set scoreFinal 8 } else={ :set scoreFinal 0 }
    }

    :local routerName [/system identity get name]
    /log warning message=("[FAILOVER v7] Link: " . $linkFinal . " alterado para: " . $statusFinal . " (Score: " . [:tostr $scoreFinal] . "/8)")

    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
    :local routerToken "SEU_TOKEN_AQUI"
    :local payload ("token=" . $routerToken . "&link=" . $linkFinal . "&status=" . $statusFinal . "&score=" . [:tostr $scoreFinal])

    :do {
        /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
    } on-error={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        } on-error={
            /log error message=("[FAILOVER v7] Falha ao enviar telemetria para a API do TRACERT+")
        }
    }
}

# =======================================================================
# 3. SETUP DINAMICO DE TABELAS FIB E ROTAS DE TESTE (ROUTEROS v7)
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

        # No RouterOS v7: pré-criação mandatória da tabela FIB
        :do {
            /routing table add name=$tabName fib
        } on-error={}

        # No RouterOS v7: rota com routing-table
        :do {
            /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-table=$tabName comment=("!== Rota de teste para " . $cleanName)
        } on-error={}

        # No RouterOS v7: regra em /routing rule
        :do {
            /routing rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cleanName)
        } on-error={}

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
# 4. SCRIPT DE MONITORAMENTO DE FAILOVER (ROUTEROS v7)
# =======================================================================
/system script add dont-require-permissions=no name="failover" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local IPsParaTeste [:toarray "8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8"]
    :local NumeroDePings 2
    :local Intervalo 00:00:00.5
    :local ScoreMinimoUP 3

    :global foRouterName [/system identity get name]
    :global foLinkName
    :global foLinkStatus
    :global foPingScore
    :global comentario
    :global LinkStatus
    :global LinkState

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

            # No RouterOS v7: extrai o nome da interface física do gateway dinâmico/DHCP via immediate-gw
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
                    /ip route set $i disabled=yes
                    :set totalRotasAtivas ($totalRotasAtivas - 1)
                    :set comentario $cleanName
                    :set LinkState 0
                    :set LinkStatus "DOWN"
                    :set foLinkName $cleanName
                    :set foLinkStatus "DOWN"
                    :set foPingScore $scoreAtual
                    :do { /system script run FAILOVER_ACTIONS } on-error={}
                } else={
                    /log warning message=("[FAILOVER v7] Link " . $cleanName . " falhou (Score " . [:tostr $scoreAtual] . "/8), mantido ativo por ser o unico restante!")
                    :set comentario $cleanName
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
                /ip route set $i disabled=no
                :set totalRotasAtivas ($totalRotasAtivas + 1)
                :set comentario $cleanName
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
/system scheduler remove [find name="executa script failover"]
/system scheduler add interval=30s name="executa script failover" on-event="failover" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# Executa imediatamente a primeira checagem para publicar os links
:do { /system script run failover } on-error={}
:log info message="[TRACERT+] Failover Multi-Link (RouterOS v7) provisionado e sincronizado!";
