// ПРОВЕРКА XCORE-МОДУЛЯ: декодируется ли образ как XS3?
//
// ЗАЧЕМ: модуль CUB3D/ghidra (issue #5835) в разработке. Надо
// убедиться, что он:
//   1. загружает архитектуру XCORE;
//   2. реально декодирует инструкции, а не выдаёт мусор;
//   3. даёт осмысленные мнемоники.
//
// ПОЧЕМУ НЕ Disassemble.java: такого скрипта в Ghidra нет, нужен свой.
//
// Запуск (headless):
//   analyzeHeadless <proj> <name> -process <file> -postScript XcoreCheck.java

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.Memory;

import java.util.LinkedHashMap;
import java.util.Map;

public class XcoreCheck extends GhidraScript {

    @Override
    public void run() throws Exception {
        String name = currentProgram.getName();
        String lang = currentProgram.getLanguageID().toString();
        println("=== XCORE CHECK: " + name + " ===");
        println("language: " + lang);

        Memory mem = currentProgram.getMemory();
        Address start = currentProgram.getMinAddress();
        Address end = currentProgram.getMaxAddress();
        println("address range: " + start + " .. " + end);

        // Идём по образу и считаем, сколько инструкций декодируется
        // подряд, прежде чем встретим мусор.
        Map<String, Integer> mnem = new LinkedHashMap<>();
        int total = 0;
        int covered = 0;
        long totalBytes = end.subtract(start) + 1;

        Address cur = start;
        int guard = 0;

        while (cur != null && cur.compareTo(end) <= 0 && guard < 200000) {
            guard++;
            Instruction ins = getInstructionAt(cur);
            if (ins == null) {
                // Пробуем дизассемблировать одну инструкцию.
                // В Ghidra disassemble(Address) возвращает boolean,
                // а сама инструкция появляется в листинге.
                boolean ok = false;
                try {
                    ok = disassemble(cur);
                } catch (Exception e) {
                    ok = false;
                }
                if (!ok) {
                    cur = cur.add(4);
                    continue;
                }
                ins = getInstructionAt(cur);
            }
            if (ins == null) {
                cur = cur.add(4);
                continue;
            }

            total++;
            covered += ins.getLength();
            mnem.merge(ins.getMnemonicString(), 1, Integer::sum);
            cur = ins.getMaxAddress().add(1);

            if (total >= 50000) break;
        }

        println("--- РЕЗУЛЬТАТ ---");
        println("инструкций декодировано: " + total);
        println("байт покрыто:            " + covered);
        println("всего байт:              " + totalBytes);
        if (totalBytes > 0) {
            println("покрытие: " + String.format("%.2f%%", 100.0 * covered / totalBytes));
        }

        println("--- ТОП МНЕМОНИК ---");
        mnem.entrySet().stream()
            .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
            .limit(20)
            .forEach(e -> println("  " + String.format("%-10s %6d", e.getKey(), e.getValue())));

        println("уникальных мнемоник: " + mnem.size());
        println("=== END ===");
    }
}
