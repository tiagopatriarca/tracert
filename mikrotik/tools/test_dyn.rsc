:local dynEntry [/ip firewall address-list find list="SDWAN_TARGETS" comment="conttroller.tiplus.inf.br" dynamic=yes]
:put ("dynEntry len: " . [:len $dynEntry])
:if ([:len $dynEntry] > 0) do={
    :local ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
    :put ("ipParaTestar: " . $ipParaTestar)
}