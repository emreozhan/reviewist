import { code } from './code';

/** Diff dışında kalan ama değişikliklerden etkilenen dosyalar (yalnız head içeriği). */

const notifierImpl = (name: string, channel: string, client: string, sendCall: string) => code`
package com.shop.adapter.out.notification;

import com.shop.application.notification.AbstractNotifier;
import com.shop.domain.order.OrderEvent;
import org.springframework.stereotype.Component;

@Component
public class ${name} extends AbstractNotifier {

    private final ${client} client;

    public ${name}(${client} client) {
        this.client = client;
    }

    @Override
    protected String format(OrderEvent event) {
        return "[${channel}] Order " + event.orderId() + " is " + event.type();
    }

    @Override
    protected void send(String recipient, String message) {
        ${sendCall}
    }
}
`;

export const emailNotifierNew = notifierImpl('EmailNotifier', 'mail', 'MailClient', 'client.sendMail(recipient, "Order update", message);');
export const smsNotifierNew = notifierImpl('SmsNotifier', 'sms', 'SmsClient', 'client.sendSms(recipient, message);');
export const pushNotifierNew = notifierImpl('PushNotifier', 'push', 'PushClient', 'client.push(recipient, message);');

export const eventListenerNew = code`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import java.util.List;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {

    private final List<AbstractNotifier> notifiers;

    public OrderEventListener(List<AbstractNotifier> notifiers) {
        this.notifiers = notifiers;
    }

    @EventListener
    public void onOrderPlaced(OrderEvent event) {
        for (AbstractNotifier notifier : notifiers) {
            notifier.notify(event);
        }
    }
}
`;

export const invoicePrinterNew = code`
package com.shop.adapter.out.report;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import com.shop.util.StringUtils;

public class InvoicePrinter {

    private static final int SKU_COLUMN = 18;

    public String print(Order order) {
        StringBuilder out = new StringBuilder("Invoice " + order.id() + "\n");
        for (OrderLine line : order.lines()) {
            out.append(StringUtils.legacyPad(line.sku(), SKU_COLUMN))
               .append(line.quantity())
               .append("\n");
        }
        return out.toString();
    }
}
`;

export const refundServiceNew = code`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;
import org.springframework.stereotype.Service;

@Service
public class RefundService {

    private final PaymentGateway payments;

    public RefundService(PaymentGateway payments) {
        this.payments = payments;
    }

    /** Compensates a partially failed order by charging a negative amount. */
    public boolean compensate(Money amount, String customerId) {
        return payments.charge(amount.negate(), customerId);
    }
}
`;

export const moneyTestNew = code`
package com.shop.domain.money;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.Currency;
import org.junit.jupiter.api.Test;

class MoneyTest {

    private static final Currency TRY = Currency.getInstance("TRY");

    @Test
    void addsAmounts() {
        Money a = new Money(new BigDecimal("10.00"), TRY);
        assertThat(a.plus(a).value()).isEqualByComparingTo("20.00");
    }

    @Test
    void convertsToMinorUnits() {
        assertThat(new Money(new BigDecimal("12.34"), TRY).toMinorUnits()).isEqualTo(1234L);
    }
}
`;
