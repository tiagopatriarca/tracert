# =======================================================================
# INSTALAÇÃO COMPLETA: FAILOVER MULTILINK V2 (COM MELHORIAS)
# =======================================================================

# -----------------------------------------------------------------------
# PARTE 1: Script FAILOVER_ACTIONS
# -----------------------------------------------------------------------
/system script remove [find name="FAILOVER_ACTIONS"]
/system script add dont-require-permissions=no name="FAILOVER_ACTIONS" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :global foLinkName
    :global foLinkStatus
    :global foPingScore
    :global foRouterName

    :local emoji "%F0%9F%94%B4"
    :if ($foLinkStatus = "UP") do={
        :set emoji "%F0%9F%9F%A2"
    }

    /log warning message=("[FAILOVER] Link: " . $foLinkName . " alterado para: " . $foLinkStatus . " (Score: " . $foPingScore . "/8)")

    :local dadosN8n ("roteador=" . $foRouterName . "&link=" . $foLinkName . "&status=" . $foLinkStatus . "&score=" . $foPingScore . "&emoji=" . $emoji)

    :do {
        /tool fetch http-method=post http-data=$dadosN8n url="https://n8n.tiplus.inf.br/webhook/749361da-2d2b-42e5-b935-66310db69f0c" keep-result=no
    } on-error={
        /log error message=("[FAILOVER] Erro ao enviar notificacao HTTP ao n8n para " . $foLinkName)
    }
}

# -----------------------------------------------------------------------
# PARTE 2: Setup de Rotas de Teste e Tabelas FIB (RouterOS v7)
# -----------------------------------------------------------------------
/ip route remove [find comment~"!=="]
/ip route rule remove [find comment~"!=="]
/system script remove [find name="failover"]
/system scheduler remove [find name="executa script failover"]

:foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-mark<>""] do={
    :local gw [/ip route get $i gateway]
    :local cmt [/ip route get $i comment]

    :if ([:len $cmt] > 0) do={
        :local safeCmt ""
        :for idx from=0 to=([:len $cmt] - 1) do={
            :local char [:pick $cmt $idx ($idx + 1)]
            :if ($char = " ") do={ :set char "-" }
            :set safeCmt ($safeCmt . $char)
        }

        :local tabName ("rota-de-teste-para-" . $safeCmt)

        :do {
            /routing table add name=$tabName fib
        } on-error={}

        /ip route add dst-address=0.0.0.0/0 gateway=$gw routing-table=$tabName comment=("!== Rota de teste para " . $cmt)
        /ip route rule add action=lookup-only-in-table routing-mark=$tabName table=$tabName comment=("!== Force teste para o failover ==> " . $cmt)
    }
}

# -----------------------------------------------------------------------
# PARTE 3: Script failover (Checagem periódica com Histerese e Proteção)
# -----------------------------------------------------------------------
/system script add dont-require-permissions=no name="failover" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local IPsParaTeste [:toarray "8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8"]
    :local NumeroDePings 2
    :local Intervalo 00:00:00.5
    :local ScoreMinimoUP 3
    :local MaxFalhasParaDown 3
    :local MaxSucessosParaUp 2

    :global foRouterName [/system identity get name]
    :global foLinkName
    :global foLinkStatus
    :global foPingScore

    :global foFailCounts
    :global foSuccessCounts
    :if ([:typeof $foFailCounts] != "array") do={ :set foFailCounts [:toarray ""] }
    :if ([:typeof $foSuccessCounts] != "array") do={ :set foSuccessCounts [:toarray ""] }

    :local totalRotasAtivas [/ip route print count-only where dst-address=0.0.0.0/0 routing-mark<>"" disabled=no comment!~"!=="]

    :foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-mark<>""] do={
        :local cmt [/ip route get $i comment]
        
        :if ([:len $cmt] > 0 and !($cmt ~ "!==")) do={
            :delay 1

            :local safeCmt ""
            :for idx from=0 to=([:len $cmt] - 1) do={
                :local char [:pick $cmt $idx ($idx + 1)]
                :if ($char = " ") do={ :set char "-" }
                :set safeCmt ($safeCmt . $char)
            }
            :local TabRoteAtual ("rota-de-teste-para-" . $safeCmt)

            :local scoreAtual 0
            :foreach ip in=$IPsParaTeste do={
                :local res [ping $ip interval=$Intervalo count=$NumeroDePings routing-table=$TabRoteAtual]
                :set scoreAtual ($scoreAtual + $res)
            }

            :local failCount ($foFailCounts->$safeCmt)
            :local succCount ($foSuccessCounts->$safeCmt)
            :if ([:len $failCount] = 0) do={ :set failCount 0 }
            :if ([:len $succCount] = 0) do={ :set succCount 0 }

            :local rotaDesativada [/ip route get $i disabled]

            :if ($scoreAtual < $ScoreMinimoUP) do={
                :set failCount ($failCount + 1)
                :set succCount 0
                :set ($foFailCounts->$safeCmt) $failCount
                :set ($foSuccessCounts->$safeCmt) 0

                :if ($failCount >= $MaxFalhasParaDown and $rotaDesativada = false) do={
                    :if ($totalRotasAtivas > 1) do={
                        /ip route disable $i
                        :set totalRotasAtivas ($totalRotasAtivas - 1)

                        :set foLinkName $cmt
                        :set foLinkStatus "DOWN"
                        :set foPingScore $scoreAtual
                        /system script run FAILOVER_ACTIONS
                    } else={
                        /log warning message=("[FAILOVER] Alerta: Link " . $cmt . " falhou, mas NAO foi desativado por ser o unico link restante!")
                    }
                }
            }

            :if ($scoreAtual >= $ScoreMinimoUP) do={
                :set succCount ($succCount + 1)
                :set failCount 0
                :set ($foSuccessCounts->$safeCmt) $succCount
                :set ($foFailCounts->$safeCmt) 0

                :if ($succCount >= $MaxSucessosParaUp and $rotaDesativada = true) do={
                    /ip route enable $i
                    :set totalRotasAtivas ($totalRotasAtivas + 1)

                    :set foLinkName $cmt
                    :set foLinkStatus "UP"
                    :set foPingScore $scoreAtual
                    /system script run FAILOVER_ACTIONS
                }
            }
        }
    }
}

# -----------------------------------------------------------------------
# PARTE 4: Scheduler
# -----------------------------------------------------------------------
/system scheduler add interval=30s name="executa script failover" on-event="failover" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
