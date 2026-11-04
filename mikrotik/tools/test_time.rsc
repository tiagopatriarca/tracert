:local t1 [/system clock get time]
:local r [/ping 8.8.8.8 count=3 interval=0.1 interface=ether1-TIM]
:local t2 [/system clock get time]
:put ("r: " . $r . " t1: " . $t1 . " t2: " . $t2)