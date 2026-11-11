import { code } from './code';

export const stringUtilsOld = code`
package com.shop.util;

public final class StringUtils {

    private StringUtils() {
    }

    public static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    public static String truncate(String s, int max) {
        if (s == null || s.length() <= max) return s;
        return s.substring(0, max - 1) + "…";
    }

    /**
     * @deprecated use {@link String#format} instead
     */
    @Deprecated
    public static String legacyPad(String s, int width) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < width) sb.append(' ');
        return sb.toString();
    }
}
`;

export const stringUtilsNew = code`
package com.shop.util;

public final class StringUtils {

    private StringUtils() {}

    public static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Truncates {@code s} to {@code max} characters, appending an ellipsis. */
    public static String truncate(String s, int max) {
        if (s == null || s.length() <= max) {
            return s;
        }
        return s.substring(0, max - 1) + "…";
    }
}
`;

export const legacyFormatterOld = code`
package com.shop.util;

import com.shop.domain.money.Money;
import java.text.DecimalFormat;

@Deprecated
public class LegacyMoneyFormatter {

    private static final DecimalFormat FORMAT = new DecimalFormat("#,##0.00");

    public static String format(Money money) {
        return FORMAT.format(money.value()) + " " + money.currency().getSymbol();
    }
}
`;

export const reportGeneratorOld = code`
package com.shop.adapter.out.report;

import java.util.List;
import java.time.LocalDate;
import com.shop.domain.order.Order;
import java.util.stream.Collectors;

public class ReportGenerator {

    public String dailyReport(LocalDate day, List<Order> orders) {
        String header = "Daily report " + day;
        String body = orders.stream().map(o -> o.id() + " " + o.status()).collect(Collectors.joining("\n"));
        return header + "\n" + body;
    }

    public int count(List<Order> orders){
        return orders.size();
    }
}
`;

export const reportGeneratorNew = code`
package com.shop.adapter.out.report;

import com.shop.domain.order.Order;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

public class ReportGenerator {

    public String dailyReport(LocalDate day, List<Order> orders) {
        String header = "Daily report " + day;
        String body = orders.stream()
                .map(o -> o.id() + " " + o.status())
                .collect(Collectors.joining("\n"));
        return header + "\n" + body;
    }

    public int count(List<Order> orders) {
        return orders.size();
    }
}
`;

export const pomOld = code`
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.shop</groupId>
    <artifactId>shop</artifactId>
    <version>1.4.0-SNAPSHOT</version>

    <properties>
        <java.version>21</java.version>
        <stripe.version>24.3.0</stripe.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>com.stripe</groupId>
            <artifactId>stripe-java</artifactId>
            <version>${'$'}{stripe.version}</version>
        </dependency>
        <dependency>
            <groupId>com.iyzipay</groupId>
            <artifactId>iyzipay-java</artifactId>
            <version>2.0.131</version>
        </dependency>
    </dependencies>
</project>
`;

export const pomNew = pomOld.replace('24.3.0', '26.1.0').replace(
  '    </dependencies>',
  [
    '        <dependency>',
    '            <groupId>org.flywaydb</groupId>',
    '            <artifactId>flyway-core</artifactId>',
    '        </dependency>',
    '    </dependencies>',
  ].join('\n'),
);

export const appYmlOld = code`
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/shop
  jpa:
    open-in-view: false

payment:
  provider: stripe
  stripe:
    timeout: 10s
`;

export const appYmlNew = code`
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/shop
  jpa:
    open-in-view: false
  flyway:
    enabled: true

payment:
  provider: stripe
  stripe:
    timeout: 30s
  idempotency:
    ttl: 24h
`;

export const migrationNew = code`
ALTER TABLE orders ADD COLUMN payment_tx_id VARCHAR(64);
CREATE UNIQUE INDEX ux_orders_payment_tx ON orders (payment_tx_id);
`;

export const messagesOld = code`
order.created=Siparişiniz alındı
order.cancelled=Siparişiniz iptal edildi
payment.failed=Ödeme başarısız
`;

export const messagesNew = code`
order.created=Siparişiniz alındı
order.cancelled=Siparişiniz iptal edildi
payment.failed=Ödeme başarısız oldu, lütfen tekrar deneyin
payment.declined=Kartınız reddedildi
`;
