// СРАВНЕНИЕ РАСПРЕДЕЛЕНИЯ МНЕМОНИК: наш образ vs эталон vs шум.
//
// ЗАЧЕМ: xCORE — 16-битная ISA, почти любая пара байт декодируется.
// Поэтому «50 000 инструкций» ничего не доказывает.
//
// Правильная проверка: сравнить РАСПРЕДЕЛЕНИЕ мнемоник.
//   • настоящий xCORE-код на эталоне даёт характерный профиль;
//   • случайные данные дают другой профиль;
//   • если наш образ ближе к эталону — это XCORE.
//
// Считаем косинусное сходство распределений и долю частых инструкций.
//
// Запуск:
//   analyzeHeadless <proj> <name> -process <file> -noanalysis \
//     -scriptPath <dir> -postScript MnemonicProfile.java [baseline.json]

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashMap;
import java.util.Map;

public class MnemonicProfile extends GhidraScript {

    private static final int TARGET = 60000;

    @Override
    public void run() throws Exception {
        String name = currentProgram.getName();
        println("=== MNEMONIC PROFILE: " + name + " ===");

        Address start = currentProgram.getMinAddress();
        Address end = currentProgram.getMaxAddress();

        Map<String, Integer> mnem = new LinkedHashMap<>();
        int total = 0;
        int covered = 0;

        Address cur = start;
        int guard = 0;
        while (cur != null && cur.compareTo(end) <= 0 && guard < 400000) {
            guard++;
            Instruction ins = getInstructionAt(cur);
            if (ins == null) {
                boolean ok = false;
                try {
                    ok = disassemble(cur);
                } catch (Exception e) {
                    ok = false;
                }
                if (!ok) {
                    cur = cur.add(2);
                    continue;
                }
                ins = getInstructionAt(cur);
            }
            if (ins == null) {
                cur = cur.add(2);
                continue;
            }
            total++;
            covered += ins.getLength();
            mnem.merge(ins.getMnemonicString(), 1, Integer::sum);
            cur = ins.getMaxAddress().add(1);
            if (total >= TARGET) break;
        }

        println("инструкций: " + total + ", байт покрыто: " + covered);
        println("уникальных мнемоник: " + mnem.size());

        // Топ-25 с долями — чтобы можно было сравнить глазами и числом
        println("--- ПРОФИЛЬ (топ-25) ---");
        final int tot = total;
        mnem.entrySet().stream()
            .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
            .limit(25)
            .forEach(e -> println(String.format("  %-10s %6d  %5.2f%%",
                e.getKey(), e.getValue(), 100.0 * e.getValue() / tot)));

        // Сохраняем профиль в файл для внешнего сравнения
        String outDir = System.getenv("M62_PROFILE_OUT");
        if (outDir == null) outDir = "E:\\Programming shit\\Topping\\research\\ghidra-profiles";
        new File(outDir).mkdirs();
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        File f = new File(outDir, safe + ".csv");
        try (PrintWriter w = new PrintWriter(f, "UTF-8")) {
            w.println("mnemonic,count");
            mnem.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .forEach(e -> w.println(e.getKey() + "," + e.getValue()));
        }
        println("профиль записан: " + f.getAbsolutePath());
        println("=== END ===");
    }
}
