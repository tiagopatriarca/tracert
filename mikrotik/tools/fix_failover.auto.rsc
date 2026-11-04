/system script set failover source="# IPs a serem testados
:local IPsParaTeste [:toarray \"8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8\"]
:local NumeroDePings 2
:local Intervalo 00:00:00.5
:local ScoreMinimoUP 3

:global foRouterName [/system identity get name]
:global foLinkName
:global foLinkStatus
:global foPingScore

:foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-table=main] do={
    :local cmt [/ip route get $i comment]
    :local gw [/ip route get $i gateway]
    :if ([:len $cmt] > 0 and !($cmt ~ "!=")) do={
        :local scoreAtual 0
        :foreach ip in=$IPsParaTeste do={
            :local res 0
            :do {
                :set res [ping $ip count=$NumeroDePings interval=$Intervalo interface=$gw]
            } on-error={
                :set res [ping $ip count=$NumeroDePings interval=$Intervalo]
            }
            :set scoreAtual ($scoreAtual + $res)
        }
        :local isDis [/ip route get $i disabled]
        :if ($scoreAtual < $ScoreMinimoUP and $isDis = false) do={
            :set foLinkName $cmt
            :set foLinkStatus "DOWN"
            :set foPingScore $scoreAtual
            /system script run FAILOVER_ACTIONS
        }
        :if ($scoreAtual >= $ScoreMinimoUP and $isDis = true) do={
            :set foLinkName $cmt
            :set foLinkStatus "UP"
            :set foPingScore $scoreAtual
            /system script run FAILOVER_ACTIONS
        }
        :if ($isDis = false) do={
            :set foLinkName $cmt
            :set foLinkStatus "UP"
            :set foPingScore $scoreAtual
            /system script run FAILOVER_ACTIONS
        }
    }
}
"
